"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { LeadStatus } from "@/lib/types";

export type ActionState = { ok: boolean; message: string };

function fail(error: unknown): ActionState {
  if (error instanceof ApiError) return { ok: false, message: error.message };
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function createLeadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, message: "Email is required." };

  const tagsRaw = String(formData.get("tags") ?? "").trim();

  try {
    await api.createLead({
      email,
      first_name: String(formData.get("first_name") ?? "").trim() || null,
      last_name: String(formData.get("last_name") ?? "").trim() || null,
      company: String(formData.get("company") ?? "").trim() || null,
      title: String(formData.get("title") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      source: String(formData.get("source") ?? "").trim() || "manual",
      tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true, message: "Lead added." };
}

export async function updateLeadStatusAction(
  leadId: string,
  status: LeadStatus,
): Promise<ActionState> {
  try {
    await api.setLeadStatus(leadId, status);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { ok: true, message: "Status updated." };
}

export async function deleteLeadAction(leadId: string): Promise<ActionState> {
  try {
    await api.deleteLead(leadId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true, message: "Lead deleted." };
}

export async function addNoteAction(
  leadId: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) return { ok: false, message: "Write a note first." };

  const type = String(formData.get("type") ?? "note");

  try {
    await api.addActivity(leadId, { type, summary });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { ok: true, message: type === "replied" ? "Reply logged." : "Note added." };
}

export async function enrollAction(
  sequenceId: string,
  leadIds: string[],
): Promise<ActionState> {
  if (!leadIds.length) return { ok: false, message: "Select at least one lead." };

  try {
    const result = await api.enroll(sequenceId, leadIds);
    revalidatePath("/leads");
    revalidatePath("/queue");
    revalidatePath("/");

    if (result.enrolled === 0) {
      const reason = Object.values(result.reasons)[0] ?? "no eligible leads";
      return { ok: false, message: `Nothing enrolled — ${reason}.` };
    }

    const skipped = result.skipped ? `, ${result.skipped} skipped` : "";
    return { ok: true, message: `Enrolled ${result.enrolled} lead(s)${skipped}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function stopEnrollmentAction(enrollmentId: string): Promise<ActionState> {
  try {
    await api.stopEnrollment(enrollmentId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/queue");
  revalidatePath("/");
  return { ok: true, message: "Enrollment stopped." };
}

export async function createSequenceAction(payload: {
  name: string;
  description: string;
  steps: { step_order: number; delay_days: number; subject: string; body: string }[];
}): Promise<ActionState> {
  if (!payload.name.trim()) return { ok: false, message: "Give the sequence a name." };
  if (!payload.steps.length) return { ok: false, message: "Add at least one step." };

  const incomplete = payload.steps.find((s) => !s.subject.trim() || !s.body.trim());
  if (incomplete) {
    return { ok: false, message: `Step ${incomplete.step_order} needs a subject and body.` };
  }

  try {
    await api.createSequence(payload);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/sequences");
  return { ok: true, message: "Sequence created." };
}

export async function deleteSequenceAction(id: string): Promise<ActionState> {
  try {
    await api.deleteSequence(id);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/sequences");
  revalidatePath("/");
  return { ok: true, message: "Sequence deleted." };
}

export async function runNowAction(): Promise<ActionState> {
  try {
    const result = await api.runNow();
    revalidatePath("/queue");
    revalidatePath("/");
    revalidatePath("/leads");

    if (!result.sent && !result.failed) {
      return { ok: true, message: "Nothing was due to send." };
    }
    const failed = result.failed ? `, ${result.failed} failed` : "";
    return { ok: true, message: `Sent ${result.sent}${failed}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function importCsvAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) {
    return { ok: false, message: "Choose a CSV file to upload." };
  }

  const upload = new FormData();
  upload.append("file", file);

  try {
    const res = await fetch(`${process.env.API_URL ?? "http://api:8000"}/api/leads/import`, {
      method: "POST",
      body: upload,
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: data.detail ?? "Import failed." };
    }

    revalidatePath("/leads");
    revalidatePath("/");

    const parts = [`${data.created} created`, `${data.updated} updated`];
    if (data.skipped) parts.push(`${data.skipped} skipped`);
    const detail = data.errors?.length ? ` First issue: ${data.errors[0]}` : "";
    return { ok: true, message: `${parts.join(", ")}.${detail}` };
  } catch {
    return { ok: false, message: "Import failed. Is the API running?" };
  }
}
