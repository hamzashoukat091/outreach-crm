"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type {
  EmailDraft,
  Prospect,
  ProspectStatus,
  ReplySituation,
  StrategyKind,
} from "@/lib/prospect-types";

export type ActionState = { ok: boolean; message: string };

function fail(error: unknown): ActionState {
  if (error instanceof ApiError) return { ok: false, message: error.message };
  return { ok: false, message: "Something went wrong. Please try again." };
}

function refreshProspect(id?: string) {
  revalidatePath("/prospects");
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/prospects/${id}`);
}

// ---------- Import ----------

export async function importProspectsAction(
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
    const res = await fetch(
      `${process.env.API_URL ?? "http://api:8000"}/api/prospects/import`,
      { method: "POST", body: upload, cache: "no-store" },
    );
    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: data.detail ?? "Import failed." };
    }

    refreshProspect();

    const parts = [`${data.created} added`];
    if (data.updated) parts.push(`${data.updated} updated`);
    if (data.skipped) parts.push(`${data.skipped} skipped`);
    const incomplete = data.incomplete
      ? ` ${data.incomplete} need company info.`
      : "";
    const firstError = data.errors?.length ? ` First issue: ${data.errors[0]}` : "";

    return { ok: true, message: `${parts.join(", ")}.${incomplete}${firstError}` };
  } catch {
    return { ok: false, message: "Import failed. Is the API running?" };
  }
}

// ---------- CRUD ----------

export async function createProspectAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, message: "Email is required." };

  const payload: Record<string, unknown> = { email };
  for (const field of [
    "first_name",
    "last_name",
    "job_title",
    "seniority",
    "company_name",
    "industry",
    "employee_range",
    "company_description",
  ]) {
    const value = String(formData.get(field) ?? "").trim();
    if (value) payload[field] = value;
  }

  try {
    await api.createProspect(payload as Partial<Prospect>);
  } catch (error) {
    return fail(error);
  }

  refreshProspect();
  return { ok: true, message: "Prospect added." };
}

export async function updateProspectAction(
  id: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const payload: Record<string, unknown> = {};
  for (const field of [
    "first_name",
    "last_name",
    "email",
    "job_title",
    "job_department",
    "seniority",
    "linkedin",
    "company_name",
    "company_domain",
    "company_website",
    "industry",
    "employee_range",
    "revenue_range",
    "company_city",
    "company_description",
    "notes",
  ]) {
    if (formData.has(field)) {
      payload[field] = String(formData.get(field) ?? "").trim() || null;
    }
  }

  try {
    await api.updateProspect(id, payload as Partial<Prospect>);
  } catch (error) {
    return fail(error);
  }

  refreshProspect(id);
  return { ok: true, message: "Saved." };
}

export async function setProspectStatusAction(
  id: string,
  status: ProspectStatus,
): Promise<ActionState> {
  try {
    await api.updateProspect(id, { status });
  } catch (error) {
    return fail(error);
  }

  refreshProspect(id);
  return { ok: true, message: "Status updated." };
}

export async function deleteProspectAction(id: string): Promise<ActionState> {
  try {
    await api.deleteProspect(id);
  } catch (error) {
    return fail(error);
  }

  refreshProspect();
  return { ok: true, message: "Prospect deleted." };
}

export async function bulkDeleteProspectsAction(ids: string[]): Promise<ActionState> {
  if (!ids.length) return { ok: false, message: "Select at least one prospect." };

  try {
    const result = await api.bulkDeleteProspects(ids);
    refreshProspect();
    return { ok: true, message: `Deleted ${result.deleted} prospect(s).` };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveProspectAction(
  id: string,
  archived: boolean,
  reason?: string,
): Promise<ActionState> {
  try {
    if (archived) await api.archiveProspect(id, reason);
    else await api.unarchiveProspect(id);
  } catch (error) {
    return fail(error);
  }

  refreshProspect(id);
  return {
    ok: true,
    message: archived ? "Archived." : "Restored to your active list.",
  };
}

export async function bulkArchiveAction(
  ids: string[],
  archived: boolean,
): Promise<ActionState> {
  if (!ids.length) return { ok: false, message: "Select at least one prospect." };

  try {
    const result = await api.bulkArchiveProspects(ids, archived);
    refreshProspect();
    return {
      ok: true,
      message: archived
        ? `Archived ${result.updated} prospect(s).`
        : `Restored ${result.updated} prospect(s).`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function logProspectEventAction(
  id: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) return { ok: false, message: "Write something first." };
  const type = String(formData.get("type") ?? "note");

  try {
    await api.addProspectEvent(id, { type, summary });
  } catch (error) {
    return fail(error);
  }

  refreshProspect(id);
  const label =
    type === "replied" ? "Reply logged." : type === "bounced" ? "Bounce logged." : "Note added.";
  return { ok: true, message: label };
}

// ---------- Generation ----------

export type GenerateState = ActionState & { draft?: EmailDraft };

export async function generateAction(
  prospectId: string,
  strategyId?: string,
): Promise<GenerateState> {
  try {
    const draft = await api.generate(prospectId, strategyId);
    refreshProspect(prospectId);
    const warning =
      draft.context_quality === "thin"
        ? " Context was limited, so review it closely."
        : "";
    return { ok: true, message: `Draft ready.${warning}`, draft };
  } catch (error) {
    return fail(error);
  }
}

export async function generateBulkAction(
  prospectIds: string[],
  strategyId?: string,
): Promise<ActionState> {
  if (!prospectIds.length) return { ok: false, message: "Select at least one prospect." };
  if (prospectIds.length > 25) {
    return { ok: false, message: "Generate for at most 25 prospects at a time." };
  }

  try {
    const result = await api.generateBulk(prospectIds, strategyId);
    refreshProspect();

    if (result.generated === 0) {
      const reason = Object.values(result.errors)[0] ?? "unknown error";
      return { ok: false, message: `Nothing generated — ${reason}` };
    }

    const failed = result.failed ? `, ${result.failed} failed` : "";
    return {
      ok: true,
      message: `Generated ${result.generated} draft(s)${failed}. Review them on each prospect's page.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ---------- Drafts ----------

export async function approveDraftAction(draftId: string): Promise<ActionState> {
  try {
    const draft = await api.approveDraft(draftId);
    refreshProspect(draft.prospect_id);
    return { ok: true, message: "Copied and marked as sent." };
  } catch (error) {
    return fail(error);
  }
}

export async function saveDraftAction(
  draftId: string,
  payload: { subject: string; body: string },
): Promise<ActionState> {
  try {
    const draft = await api.updateDraft(draftId, payload);
    refreshProspect(draft.prospect_id);
    return { ok: true, message: "Draft saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function discardDraftAction(draftId: string): Promise<ActionState> {
  try {
    const draft = await api.discardDraft(draftId);
    refreshProspect(draft.prospect_id);
    return { ok: true, message: "Draft discarded." };
  } catch (error) {
    return fail(error);
  }
}

// ---------- Sender profile ----------

export async function saveSenderAction(payload: {
  name: string;
  headline: string;
  offer: string;
  proof: string;
  call_to_action: string;
  signature: string;
}): Promise<ActionState> {
  if (!payload.offer.trim()) {
    return { ok: false, message: "Describe what you offer — that's the part emails are built on." };
  }

  try {
    await api.updateSender(payload);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/strategies");
  revalidatePath("/prospects");
  return { ok: true, message: "Profile saved. New emails will use it." };
}

// ---------- Strategies ----------

export async function saveStrategyAction(
  id: string | null,
  payload: {
    name: string;
    description: string;
    system_prompt: string;
    instructions: string;
    tone: string;
    max_words: number;
    subject_hint: string;
    is_default: boolean;
    kind: StrategyKind;
    reply_situation: ReplySituation | null;
    priority: number;
  },
): Promise<ActionState> {
  if (!payload.name.trim()) return { ok: false, message: "Give the strategy a name." };
  if (!payload.instructions.trim()) {
    return { ok: false, message: "Instructions can't be empty — that's the prompt." };
  }
  if (!payload.system_prompt.trim()) {
    return { ok: false, message: "System prompt can't be empty." };
  }
  if (payload.kind === "reply" && !payload.reply_situation) {
    return { ok: false, message: "Pick which situation this reply strategy handles." };
  }

  try {
    if (id) await api.updateStrategy(id, payload);
    else await api.createStrategy(payload);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/strategies");
  revalidatePath("/prospects");
  return { ok: true, message: id ? "Strategy updated." : "Strategy created." };
}

export async function deleteStrategyAction(id: string): Promise<ActionState> {
  try {
    await api.deleteStrategy(id);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/strategies");
  return { ok: true, message: "Strategy deleted. Past drafts keep their history." };
}

export async function previewPromptAction(
  strategyId: string,
  prospectId?: string,
): Promise<ActionState & { prompt?: string; quality?: string; prospect?: string }> {
  try {
    const result = await api.previewPrompt(strategyId, prospectId);
    return {
      ok: true,
      message: "Preview ready.",
      prompt: `${result.system_prompt}\n\n${"=".repeat(60)}\n\n${result.user_message}`,
      quality: result.context_quality,
      prospect: `${result.prospect_name} <${result.prospect_email}>`,
    };
  } catch (error) {
    return fail(error);
  }
}
