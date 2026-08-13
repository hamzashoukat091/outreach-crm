import type {
  Activity,
  DashboardStats,
  Enrollment,
  EnrollResult,
  Lead,
  LeadList,
  LeadStatus,
  Sequence,
} from "./types";
import type {
  Analytics,
  DraftStatus,
  EmailDraft,
  Prospect,
  ProspectEvent,
  ProspectList,
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
  dashboard: () => request<DashboardStats>("/api/dashboard"),

  listLeads: (params: {
    q?: string;
    status?: string;
    tag?: string;
    page?: number;
    page_size?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<LeadList>(`/api/leads${suffix}`);
  },

  getLead: (id: string) => request<Lead>(`/api/leads/${id}`),

  createLead: (payload: Partial<Lead>) =>
    request<Lead>("/api/leads", { method: "POST", body: JSON.stringify(payload) }),

  updateLead: (id: string, payload: Partial<Lead>) =>
    request<Lead>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  setLeadStatus: (id: string, status: LeadStatus) =>
    request<Lead>(`/api/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  deleteLead: (id: string) => request<void>(`/api/leads/${id}`, { method: "DELETE" }),

  leadActivities: (id: string) => request<Activity[]>(`/api/leads/${id}/activities`),

  addActivity: (id: string, payload: { type: string; summary: string }) =>
    request<Activity>(`/api/leads/${id}/activities`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listSequences: () => request<Sequence[]>("/api/sequences"),

  getSequence: (id: string) => request<Sequence>(`/api/sequences/${id}`),

  createSequence: (payload: unknown) =>
    request<Sequence>("/api/sequences", { method: "POST", body: JSON.stringify(payload) }),

  updateSequence: (id: string, payload: unknown) =>
    request<Sequence>(`/api/sequences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteSequence: (id: string) =>
    request<void>(`/api/sequences/${id}`, { method: "DELETE" }),

  listEnrollments: (params: { lead_id?: string; sequence_id?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<Enrollment[]>(`/api/enrollments${suffix}`);
  },

  enroll: (sequence_id: string, lead_ids: string[]) =>
    request<EnrollResult>("/api/enrollments", {
      method: "POST",
      body: JSON.stringify({ sequence_id, lead_ids }),
    }),

  stopEnrollment: (id: string) =>
    request<void>(`/api/enrollments/${id}`, { method: "DELETE" }),

  runNow: () => request<Record<string, number>>("/api/enrollments/run-now", { method: "POST" }),

  previewTemplate: (payload: { subject: string; body: string; lead_id?: string }) =>
    request<{ subject: string; body: string; missing_fields: string[] }>("/api/leads/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ---------- Prospects ----------

  listProspects: (
    params: {
      q?: string;
      status?: string;
      seniority?: string;
      industry?: string;
      completeness?: string;
      has_draft?: boolean;
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

  approveDraft: (id: string) =>
    request<EmailDraft>(`/api/drafts/${id}/approve`, { method: "POST" }),

  discardDraft: (id: string) =>
    request<EmailDraft>(`/api/drafts/${id}/discard`, { method: "POST" }),

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
};
