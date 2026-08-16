import type {
  ApprovalItem,
  AutomationAnalytics,
  AutomationMessage,
  AutomationMessageDetail,
  AutomationSequence,
  AutomationSettings,
  AutomationStatus,
  EnrollMode,
  EnrollmentDetail,
  EnrollmentRow,
  EnrollResponse,
  InboxItem,
  MessageList,
  SenderFacts,
  SequenceStep,
  SettingsSection,
} from "./types";
import type {
  Analytics,
  CategoryCount,
  DraftPrompt,
  DraftStatus,
  EmailDraft,
  Prospect,
  ProspectEvent,
  ProspectList,
  SenderProfile,
  Strategy,
} from "./prospect-types";

/**
 * Server components talk to the API over the compose network (`http://api:8000`),
 * while the browser reaches it through the published port. Picking the base URL
 * per environment keeps one client usable from both sides.
 */
const SERVER_BASE = process.env.API_URL ?? "http://api:8000";
const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const apiBase = () => (typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init?.headers
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      // FastAPI puts the message in `detail`, which may itself be a list.
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = data.detail[0].msg;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // ---------- Prospects ----------

  listProspects: (
    params: {
      q?: string;
      status?: string;
      seniority?: string;
      industry?: string;
      category?: string;
      completeness?: string;
      has_draft?: boolean;
      archived?: boolean;
      page?: number;
      page_size?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<ProspectList>(`/api/prospects${suffix}`);
  },

  listProspectCategories: () =>
    request<CategoryCount[]>("/api/prospects/categories"),

  getProspect: (id: string) => request<Prospect>(`/api/prospects/${id}`),

  createProspect: (payload: Partial<Prospect>) =>
    request<Prospect>("/api/prospects", { method: "POST", body: JSON.stringify(payload) }),

  updateProspect: (id: string, payload: Partial<Prospect>) =>
    request<Prospect>(`/api/prospects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteProspect: (id: string) =>
    request<void>(`/api/prospects/${id}`, { method: "DELETE" }),

  archiveProspect: (id: string, reason?: string) =>
    request<Prospect>(`/api/prospects/${id}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    }),

  unarchiveProspect: (id: string) =>
    request<Prospect>(`/api/prospects/${id}/unarchive`, { method: "POST" }),

  bulkArchiveProspects: (ids: string[], archived: boolean, reason?: string) =>
    request<{ updated: number; archived: boolean }>("/api/prospects/bulk-archive", {
      method: "POST",
      body: JSON.stringify({ prospect_ids: ids, archived, reason: reason ?? null }),
    }),

  bulkDeleteProspects: (ids: string[]) =>
    request<{ deleted: number }>("/api/prospects/bulk-delete", {
      method: "POST",
      body: JSON.stringify(ids),
    }),

  prospectEvents: (id: string) =>
    request<ProspectEvent[]>(`/api/prospects/${id}/events`),

  addProspectEvent: (id: string, payload: { type: string; summary: string }) =>
    request<ProspectEvent>(`/api/prospects/${id}/events`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ---------- Pipeline handoff ----------

  handoffProspect: (id: string) =>
    request<Prospect>(`/api/prospects/${id}/handoff`, { method: "POST" }),

  returnProspectToManual: (id: string) =>
    request<Prospect>(`/api/prospects/${id}/return-to-manual`, { method: "POST" }),

  bulkHandoffProspects: (ids: string[]) =>
    request<{ updated: number; total: number }>("/api/prospects/bulk-handoff", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  bulkReturnProspectsToManual: (ids: string[]) =>
    request<{ updated: number; blocked: number; total: number }>(
      "/api/prospects/bulk-return-to-manual",
      { method: "POST", body: JSON.stringify({ ids }) },
    ),

  // ---------- Generation ----------

  generate: (prospectId: string, strategyId?: string) =>
    request<EmailDraft>(`/api/prospects/${prospectId}/generate`, {
      method: "POST",
      body: JSON.stringify({ strategy_id: strategyId ?? null }),
    }),

  generateBulk: (prospectIds: string[], strategyId?: string) =>
    request<{
      generated: number;
      failed: number;
      drafts: EmailDraft[];
      errors: Record<string, string>;
    }>("/api/prospects/generate-bulk", {
      method: "POST",
      body: JSON.stringify({ prospect_ids: prospectIds, strategy_id: strategyId ?? null }),
    }),

  prospectDrafts: (id: string) => request<EmailDraft[]>(`/api/prospects/${id}/drafts`),

  // ---------- Drafts ----------

  listDrafts: (params: { status?: DraftStatus; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<EmailDraft[]>(`/api/drafts${suffix}`);
  },

  updateDraft: (id: string, payload: { subject?: string; body?: string }) =>
    request<EmailDraft>(`/api/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  draftPrompt: (id: string) => request<DraftPrompt>(`/api/drafts/${id}/prompt`),

  approveDraft: (id: string) =>
    request<EmailDraft>(`/api/drafts/${id}/approve`, { method: "POST" }),

  discardDraft: (id: string) =>
    request<EmailDraft>(`/api/drafts/${id}/discard`, { method: "POST" }),

  // ---------- Sender profile ----------

  getSender: () => request<SenderProfile>("/api/sender"),

  updateSender: (payload: Partial<SenderProfile>) =>
    request<SenderProfile>("/api/sender", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // ---------- Strategies ----------

  listStrategies: () => request<Strategy[]>("/api/strategies"),

  createStrategy: (payload: Partial<Strategy>) =>
    request<Strategy>("/api/strategies", { method: "POST", body: JSON.stringify(payload) }),

  updateStrategy: (id: string, payload: Partial<Strategy>) =>
    request<Strategy>(`/api/strategies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteStrategy: (id: string) =>
    request<void>(`/api/strategies/${id}`, { method: "DELETE" }),

  previewPrompt: (strategyId: string, prospectId?: string) => {
    const qs = prospectId ? `?prospect_id=${prospectId}` : "";
    return request<{
      prospect_email: string;
      prospect_name: string;
      context_quality: string;
      system_prompt: string;
      user_message: string;
    }>(`/api/strategies/${strategyId}/preview${qs}`, { method: "POST" });
  },

  // ---------- Analytics ----------

  analytics: (days = 30) => request<Analytics>(`/api/analytics?days=${days}`),

  health: () =>
    request<{ status: string; ai_configured: boolean; model: string }>("/health"),

  // ---------- Automation: sequences ----------

  listAutomationSequences: () =>
    request<AutomationSequence[]>("/api/automation/sequences"),

  createAutomationSequence: (payload: { name: string; description?: string }) =>
    request<AutomationSequence>("/api/automation/sequences", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateAutomationSequence: (
    id: string,
    payload: Partial<{ name: string; description: string; is_active: boolean }>,
  ) =>
    request<AutomationSequence>(`/api/automation/sequences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteAutomationSequence: (id: string) =>
    request<void>(`/api/automation/sequences/${id}`, { method: "DELETE" }),

  addSequenceStep: (
    sequenceId: string,
    payload: {
      position?: number;
      wait_days: number;
      send_at_time?: string | null;
      strategy_id: string;
      step_instructions?: string | null;
    },
  ) =>
    request<SequenceStep>(`/api/automation/sequences/${sequenceId}/steps`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateSequenceStep: (
    stepId: string,
    payload: Partial<{
      wait_days: number;
      send_at_time: string | null;
      strategy_id: string;
      step_instructions: string | null;
      is_active: boolean;
    }>,
  ) =>
    request<SequenceStep>(`/api/automation/steps/${stepId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteSequenceStep: (stepId: string) =>
    request<void>(`/api/automation/steps/${stepId}`, { method: "DELETE" }),

  reorderSequenceSteps: (sequenceId: string, ids: string[]) =>
    request<SequenceStep[]>(`/api/automation/sequences/${sequenceId}/steps/reorder`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  enrollProspects: (
    sequenceId: string,
    payload: { prospect_ids: string[]; mode: EnrollMode; send_at?: string },
  ) =>
    request<EnrollResponse>(`/api/automation/sequences/${sequenceId}/enroll`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ---------- Automation: enrollments ----------

  listAutomationEnrollments: (
    params: { state?: string; sequence_id?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<EnrollmentRow[]>(`/api/automation/enrollments${suffix}`);
  },

  getAutomationEnrollment: (id: string) =>
    request<EnrollmentDetail>(`/api/automation/enrollments/${id}`),

  pauseEnrollment: (id: string) =>
    request<EnrollmentRow>(`/api/automation/enrollments/${id}/pause`, { method: "POST" }),

  resumeEnrollment: (id: string) =>
    request<EnrollmentRow>(`/api/automation/enrollments/${id}/resume`, { method: "POST" }),

  stopEnrollment: (id: string, returnToManual = false) =>
    request<EnrollmentRow>(
      `/api/automation/enrollments/${id}/stop${
        returnToManual ? "?return_to_manual=true" : ""
      }`,
      { method: "POST" },
    ),

  // ---------- Automation: messages ----------

  listAutomationMessages: (
    params: {
      state?: string;
      direction?: string;
      kind?: string;
      prospect_id?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<MessageList>(`/api/automation/messages${suffix}`);
  },

  getAutomationMessage: (id: string) =>
    request<AutomationMessageDetail>(`/api/automation/messages/${id}`),

  approveMessage: (id: string, payload: { subject?: string; body?: string } = {}) =>
    request<AutomationMessage>(`/api/automation/messages/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  rejectMessage: (id: string) =>
    request<AutomationMessage>(`/api/automation/messages/${id}/reject`, {
      method: "POST",
    }),

  regenerateMessage: (id: string) =>
    request<AutomationMessage>(`/api/automation/messages/${id}/regenerate`, {
      method: "POST",
    }),

  simulateReply: (prospectId: string, body: string) =>
    request<AutomationMessage>("/api/automation/simulate-reply", {
      method: "POST",
      body: JSON.stringify({ prospect_id: prospectId, body }),
    }),

  // ---------- Automation: inbox + approvals ----------

  automationInbox: () => request<InboxItem[]>("/api/automation/inbox"),

  automationApprovals: () => request<ApprovalItem[]>("/api/automation/approvals"),

  // ---------- Automation: settings ----------

  getAutomationSettings: () =>
    request<AutomationSettings>("/api/automation/settings"),

  updateAutomationSettings: (
    payload: Partial<AutomationSettings & { smtp_password: string; imap_password: string }>,
  ) =>
    request<AutomationSettings>("/api/automation/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  resetAutomationSettings: (section: SettingsSection) =>
    request<AutomationSettings>("/api/automation/settings/reset", {
      method: "POST",
      body: JSON.stringify({ section }),
    }),

  getSenderFacts: () => request<SenderFacts>("/api/automation/sender-facts"),

  updateSenderFacts: (payload: Partial<SenderFacts>) =>
    request<SenderFacts>("/api/automation/sender-facts", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // ---------- Automation: analytics + status ----------

  automationAnalytics: () =>
    request<AutomationAnalytics>("/api/automation/analytics"),

  automationStatus: () => request<AutomationStatus>("/api/automation/status"),
};
