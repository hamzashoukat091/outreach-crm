export type ProspectStatus =
  | "new"
  | "drafted"
  | "approved"
  | "replied"
  | "bounced"
  | "not_interested"
  | "won"
  | "archived";

export type DraftStatus = "draft" | "approved" | "discarded" | "failed";

export type ProspectEventType =
  | "imported"
  | "updated"
  | "generated"
  | "approved"
  | "replied"
  | "bounced"
  | "status_changed"
  | "note";

export interface IntentTopic {
  topic: string;
  score: number;
}

export interface Prospect {
  id: string;
  email: string;
  email_status: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  job_title: string | null;
  job_department: string | null;
  seniority: string | null;
  linkedin: string | null;
  prospect_city: string | null;
  prospect_region: string | null;
  prospect_country: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_website: string | null;
  company_description: string | null;
  company_city: string | null;
  company_region: string | null;
  company_country: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  industry: string | null;
  naics: string | null;
  display_company: string;
  status: ProspectStatus;
  is_complete: boolean;
  missing_fields: string[];
  company_inferred: boolean;
  is_archived: boolean;
  archived_at: string | null;
  archive_reason: string | null;
  intent_topics: IntentTopic[];
  skills: string[];
  interests: string[];
  experience: string[];
  other_emails: string[];
  top_intent: string | null;
  tags: string[];
  notes: string | null;
  draft_count: number;
  last_draft_status: DraftStatus | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectList {
  items: Prospect[];
  total: number;
  page: number;
  page_size: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  instructions: string;
  tone: string | null;
  max_words: number;
  subject_hint: string | null;
  is_default: boolean;
  is_active: boolean;
  usage_count: number;
  created_at: string;
}

export interface EmailDraft {
  id: string;
  prospect_id: string;
  strategy_id: string | null;
  strategy_name: string | null;
  subject: string;
  body: string;
  status: DraftStatus;
  model: string | null;
  context_quality: "rich" | "thin" | null;
  context_used: Record<string, unknown>;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  edited: boolean;
  approved_at: string | null;
  created_at: string;
  prospect_email: string | null;
  prospect_name: string | null;
}

/** Who is sending, and what they offer. Injected into every prompt. */
export interface SenderProfile {
  id: string;
  name: string | null;
  headline: string | null;
  offer: string | null;
  proof: string | null;
  call_to_action: string | null;
  signature: string | null;
  is_configured: boolean;
}

/** The exact API call behind one draft, fetched on demand. */
export interface DraftPrompt {
  draft_id: string;
  available: boolean;
  model: string | null;
  strategy_name: string | null;
  context_quality: "rich" | "thin" | null;
  system_prompt: string | null;
  user_prompt: string | null;
  raw_response: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string | null;
  prospect_email: string | null;
}

export interface ProspectEvent {
  id: string;
  prospect_id: string;
  type: ProspectEventType;
  summary: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ProspectImportResult {
  created: number;
  updated: number;
  skipped: number;
  incomplete: number;
  errors: string[];
}

export interface Analytics {
  total_prospects: number;
  complete: number;
  incomplete: number;
  data_completeness: number;
  by_status: { status: string; count: number }[];
  by_seniority: { label: string; count: number }[];
  by_industry: { label: string; count: number }[];
  by_employee_range: { label: string; count: number }[];
  top_intent_topics: { label: string; count: number }[];
  total_drafts: number;
  approved_drafts: number;
  approval_rate: number;
  replied_count: number;
  reply_rate: number;
  thin_context_drafts: number;
  rich_context_drafts: number;
  thin_approval_rate: number;
  rich_approval_rate: number;
  activity: { day: string; generated: number; approved: number }[];
  strategy_performance: {
    strategy_id: string | null;
    name: string;
    generated: number;
    approved: number;
    approval_rate: number;
    replied: number;
    reply_rate: number;
    avg_output_tokens: number | null;
  }[];
  total_input_tokens: number;
  total_output_tokens: number;
}
