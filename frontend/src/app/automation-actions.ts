"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type {
  AutomationSettings,
  EnrollMode,
  SenderFacts,
  SettingsSection,
} from "@/lib/types";
import type { ActionState } from "@/app/prospect-actions";

function fail(error: unknown): ActionState {
  if (error instanceof ApiError) return { ok: false, message: error.message };
  /* Not an ApiError, so the API never answered -- the usual causes are the
     API container being down or the network dropping mid-request. Naming the
     connection points at the actual fix instead of leaving the user to
     re-check their input. */
  return {
    ok: false,
    message: "Couldn't reach the server. Check your connection and try again.",
  };
}

function refreshAutomation(sequenceId?: string) {
  revalidatePath("/sequences");
  revalidatePath("/sequences/enrollments");
  revalidatePath("/inbox");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (sequenceId) revalidatePath(`/sequences/${sequenceId}`);
}

// ---------- Pipeline handoff ----------

export async function handoffProspectAction(id: string): Promise<ActionState> {
  try {
    await api.handoffProspect(id);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/prospects");
  revalidatePath(`/prospects/${id}`);
  return { ok: true, message: "Handed off to automation." };
}

export async function returnToManualAction(id: string): Promise<ActionState> {
  try {
    await api.returnProspectToManual(id);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/prospects");
  revalidatePath(`/prospects/${id}`);
  return { ok: true, message: "Back in your manual pipeline." };
}

export async function bulkHandoffAction(ids: string[]): Promise<ActionState> {
  if (!ids.length) return { ok: false, message: "Select at least one prospect." };

  try {
    const res = await api.bulkHandoffProspects(ids);
    revalidatePath("/prospects");

    if (res.updated < res.total) {
      return {
        ok: true,
        message: `Handed off ${res.updated} of ${res.total} — the rest were already automated.`,
      };
    }
    return { ok: true, message: `Handed off ${res.updated} prospect(s) to automation.` };
  } catch (error) {
    return fail(error);
  }
}

export async function bulkReturnToManualAction(ids: string[]): Promise<ActionState> {
  if (!ids.length) return { ok: false, message: "Select at least one prospect." };

  try {
    const res = await api.bulkReturnProspectsToManual(ids);
    revalidatePath("/prospects");
    refreshAutomation();

    // Being mid-sequence is the one reason a prospect can't come back, and
    // it is fixable, so name it instead of reporting a silent shortfall.
    if (res.blocked) {
      return {
        ok: true,
        message:
          `Returned ${res.updated} to manual. ${res.blocked} still running in a ` +
          `sequence — stop those on the Enrollments page first.`,
      };
    }
    if (!res.updated) {
      return { ok: true, message: "Already in your manual pipeline." };
    }
    return { ok: true, message: `Returned ${res.updated} prospect(s) to manual outreach.` };
  } catch (error) {
    return fail(error);
  }
}

export async function applyTemplateAction(
  key: string,
  name?: string,
): Promise<ActionState & { id?: string }> {
  try {
    const sequence = await api.applySequenceTemplate(key, name);
    refreshAutomation();
    return {
      ok: true,
      id: sequence.id,
      message: `Created "${sequence.name}" — edit the steps or enroll prospects.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ---------- Sequences ----------

export async function createSequenceAction(payload: {
  name: string;
  description?: string;
}): Promise<ActionState & { id?: string }> {
  if (!payload.name.trim()) return { ok: false, message: "Give the sequence a name." };

  try {
    const sequence = await api.createAutomationSequence({
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
    });
    refreshAutomation(sequence.id);
    return { ok: true, message: "Sequence created.", id: sequence.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSequenceAction(
  id: string,
  payload: Partial<{ name: string; description: string; is_active: boolean }>,
): Promise<ActionState> {
  try {
    await api.updateAutomationSequence(id, payload);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation(id);
  return { ok: true, message: "Sequence saved." };
}

export async function deleteSequenceAction(id: string): Promise<ActionState> {
  try {
    await api.deleteAutomationSequence(id);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Sequence deleted." };
}

// ---------- Steps ----------

export async function addStepAction(
  sequenceId: string,
  payload: {
    wait_days: number;
    send_at_time?: string | null;
    strategy_id: string;
    step_instructions?: string | null;
  },
): Promise<ActionState> {
  if (!payload.strategy_id) return { ok: false, message: "Pick a strategy for the step." };

  try {
    await api.addSequenceStep(sequenceId, payload);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation(sequenceId);
  return { ok: true, message: "Step added." };
}

export async function updateStepAction(
  stepId: string,
  sequenceId: string,
  payload: Partial<{
    wait_days: number;
    send_at_time: string | null;
    strategy_id: string;
    step_instructions: string | null;
    is_active: boolean;
  }>,
): Promise<ActionState> {
  try {
    await api.updateSequenceStep(stepId, payload);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation(sequenceId);
  return { ok: true, message: "Step saved." };
}

export async function deleteStepAction(
  stepId: string,
  sequenceId: string,
): Promise<ActionState> {
  try {
    await api.deleteSequenceStep(stepId);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation(sequenceId);
  return { ok: true, message: "Step removed." };
}

export async function reorderStepsAction(
  sequenceId: string,
  ids: string[],
): Promise<ActionState> {
  try {
    await api.reorderSequenceSteps(sequenceId, ids);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation(sequenceId);
  return { ok: true, message: "Steps reordered." };
}

// ---------- Enrollment ----------

export async function enrollProspectsAction(
  sequenceId: string,
  prospectIds: string[],
  mode: EnrollMode,
  sendAt?: string,
): Promise<ActionState> {
  if (!prospectIds.length) return { ok: false, message: "Select at least one prospect." };
  if (mode === "send_at" && !sendAt) {
    return { ok: false, message: "Pick a send time first." };
  }

  try {
    const res = await api.enrollProspects(sequenceId, {
      prospect_ids: prospectIds,
      mode,
      send_at: mode === "send_at" ? sendAt : undefined,
    });

    refreshAutomation(sequenceId);
    revalidatePath("/prospects");

    if (res.skipped > 0) {
      const firstSkipped = res.results.find((r) => r.status === "skipped");
      const reason = firstSkipped?.reason ? ` First issue: ${firstSkipped.reason}` : "";
      return {
        ok: res.enrolled > 0,
        message: `Enrolled ${res.enrolled} of ${res.enrolled + res.skipped}, ${res.skipped} skipped.${reason}`,
      };
    }
    return { ok: true, message: `Enrolled ${res.enrolled} prospect(s).` };
  } catch (error) {
    return fail(error);
  }
}

export async function pauseEnrollmentAction(id: string): Promise<ActionState> {
  try {
    await api.pauseEnrollment(id);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Enrollment paused." };
}

export async function resumeEnrollmentAction(id: string): Promise<ActionState> {
  try {
    await api.resumeEnrollment(id);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Enrollment resumed." };
}

export async function stopEnrollmentAction(
  id: string,
  returnToManual = false,
): Promise<ActionState> {
  try {
    await api.stopEnrollment(id, returnToManual);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  revalidatePath("/prospects");
  return {
    ok: true,
    message: returnToManual
      ? "Stopped and returned to manual outreach."
      : "Enrollment stopped.",
  };
}

// ---------- Messages ----------

export async function approveMessageAction(
  id: string,
  payload: { subject?: string; body?: string } = {},
): Promise<ActionState> {
  try {
    await api.approveMessage(id, payload);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Approved — it will go out on the next send." };
}

export async function rejectMessageAction(id: string): Promise<ActionState> {
  try {
    await api.rejectMessage(id);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Rejected. Nothing will be sent." };
}

export async function regenerateMessageAction(id: string): Promise<ActionState> {
  try {
    await api.regenerateMessage(id);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Regenerated — review the new draft." };
}

export async function simulateReplyAction(
  prospectId: string,
  body: string,
): Promise<ActionState> {
  if (!body.trim()) return { ok: false, message: "Write the reply first." };

  try {
    await api.simulateReply(prospectId, body);
  } catch (error) {
    return fail(error);
  }

  refreshAutomation();
  return { ok: true, message: "Reply received — Claude classified it." };
}

// ---------- Settings ----------

export async function saveAutomationSettingsAction(
  payload: Partial<AutomationSettings & { smtp_password: string; imap_password: string }>,
): Promise<ActionState> {
  try {
    await api.updateAutomationSettings(payload);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Settings saved." };
}

export async function resetAutomationSettingsAction(
  section: SettingsSection,
): Promise<ActionState> {
  try {
    await api.resetAutomationSettings(section);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/settings");
  return { ok: true, message: "Reset to defaults." };
}

export async function saveSenderFactsAction(
  payload: Partial<SenderFacts>,
): Promise<ActionState> {
  try {
    await api.updateSenderFacts(payload);
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/settings");
  return { ok: true, message: "Facts saved. Replies will only draw on these." };
}
