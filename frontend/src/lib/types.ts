import type { ReplySituation } from "./prospect-types";

// ---------- Sequences ----------

export interface SequenceStep {
  id: string;
  sequence_id: string;
  position: number;
  wait_days: number;
  /** "HH:MM:SS" or null. */
  send_at_time: string | null;
  strategy_id: string | null;
  strategy_name: string | null;
  step_instructions: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AutomationSequence {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  steps: SequenceStep[];
  step_count: number;
  active_enrollments: number;
  paused_enrollments: number;
  open_enrollments: number;
  replied_enrollments: number;
  finished_enrollments: number;
  total_enrollments: number;
}

export type EnrollMode = "send_now" | "draft_now_send_later" | "send_at";

export interface EnrollResultItem {
  prospect_id: string;
  email: string | null;
  status: "enrolled" | "skipped";
  reason: string | null;
  enrollment_id: string | null;
}

export interface EnrollResponse {
  enrolled: number;
  skipped: number;
  results: EnrollResultItem[];
}

// ---------- Enrollments ----------

export type EnrollmentState =
  | "active"
  | "paused"
  | "replied"
  | "stopped"
  | "bounced"
  | "completed";

/** Flat row from GET /api/automation/enrollments (prospect fields joined in). */
export interface EnrollmentRow {
  id: string;
  prospect_id: string;
  sequence_id: string;
  state: EnrollmentState;
  current_position: number;
  thread_subject: string | null;
  enrolled_at: string;
  ended_at: string | null;
  end_reason: string | null;
  last_activity_at: string | null;
  prospect_name: string | null;
  prospect_email: string | null;
  sequence_name: string | null;
  total_steps: number;
  next_message_at: string | null;
}

export interface EnrollmentDetail extends EnrollmentRow {
  messages: AutomationMessage[];
}

// ---------- Messages ----------

export type MessageDirection = "outbound" | "inbound";

/** Backend MessageOut. The detail endpoint returns the same shape. */
export interface AutomationMessage {
  id: string;
  prospect_id: string;
  enrollment_id: string | null;
  step_id: string | null;
  direction: MessageDirection;
  /** "opener" | "follow_up" | "reply" | "incoming" */
  kind: string;
  /** "drafting" | "scheduled" | "needs_approval" | "sending" | "sent" | "failed" | "cancelled" | "received" */
  state: string;
  subject: string | null;
  body: string | null;
  from_address: string | null;
  to_address: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  received_at: string | null;
  attempts: number;
  error: string | null;
  simulated: boolean;
  situation: ReplySituation | null;
  classification_confidence: number | null;
  classification_reason: string | null;
  escalated: boolean;
  escalation_reason: string | null;
  approved_at: string | null;
  edited: boolean;
  model: string | null;
  strategy_name: string | null;
  context_quality: string | null;
  created_at: string;
  // Joined for list views.
  prospect_name: string | null;
  prospect_email: string | null;
}

/** Single-message view: adds the exact strings sent to the model. */
export interface AutomationMessageDetail extends AutomationMessage {
  system_prompt: string | null;
  user_prompt: string | null;
  raw_response: string | null;
  context_used: Record<string, unknown> | null;
  input_tokens: number | null;
  output_tokens: number | null;
}


export interface MessageList {
  items: AutomationMessage[];
  total: number;
  page: number;
  page_size: number;
}

// ---------- Inbox ----------

export interface InboxItem {
  enrollment_id: string;
  prospect_id: string;
  prospect_name: string | null;
  prospect_email: string | null;
  sequence_name: string | null;
  state: EnrollmentState;
  situation: ReplySituation | null;
  pending_approval: boolean;
  latest_inbound: AutomationMessage | null;
  latest_outbound: AutomationMessage | null;
  last_activity_at: string | null;
}

// ---------- Approvals ----------

export interface ApprovalItem {
  /** The held outbound message awaiting review. */
  message: AutomationMessage;
  /** The inbound email this reply answers, if any. */
  trigger: AutomationMessage | null;
}

// ---------- Settings ----------

export type SettingsSection = "safety" | "schedule" | "limits" | "replies";

export interface AutomationSettings {
  id: string;
  // Safety
  dry_run: boolean;
  sending_paused: boolean;
  // Schedule — times come back as "HH:MM:SS" strings.
  send_window_start: string;
  send_window_end: string;
  /** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
  send_days: number[];
  timezone: string;
  default_delay_days: number;
  default_send_time: string;
  // Limits
  hourly_send_limit: number;
  daily_send_limit: number;
  // Replies
  auto_reply_enabled: boolean;
  min_confidence_to_send: number;
  always_review_first_reply: boolean;
  escalate_situations: ReplySituation[];
  // Outbound email (SMTP) — passwords never come back, only these flags.
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_use_tls: boolean;
  from_address: string | null;
  from_name: string | null;
  reply_to: string | null;
  // Inbound email (IMAP)
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
  imap_use_ssl: boolean;
  imap_folder: string;
  imap_poll_seconds: number;
  has_smtp_password: boolean;
  has_imap_password: boolean;
  updated_at: string;
}

export interface SenderFacts {
  id: string;
  rates: string | null;
  availability: string | null;
  tech_stack: string | null;
  process: string | null;
  booking_link: string | null;
  portfolio_link: string | null;
  do_not_answer: string | null;
  extra_facts: string | null;
  is_configured: boolean;
  updated_at: string;
}

/** The editable slice of SenderFacts. */
export type SenderFactField =
  | "rates"
  | "availability"
  | "tech_stack"
  | "process"
  | "booking_link"
  | "portfolio_link"
  | "do_not_answer"
  | "extra_facts";

// ---------- Analytics + status ----------

export interface StepDropoff {
  position: number;
  sent: number;
  replies_after: number;
}

export interface SequenceAnalyticsRow {
  sequence_id: string;
  name: string;
  enrolled: number;
  active: number;
  completed: number;
  replied: number;
  reply_rate: number;
  steps: StepDropoff[];
}

/** Flat — no "totals" wrapper. */
export interface AutomationAnalytics {
  active_enrollments: number;
  total_sent: number;
  replies_received: number;
  reply_rate: number;
  pending_approvals: number;
  sends_today: number;
  daily_send_limit: number;
  sequences: SequenceAnalyticsRow[];
}

export interface AutomationStatus {
  dry_run: boolean;
  sending_paused: boolean;
  window_open: boolean;
  sends_this_hour: number;
  hourly_send_limit: number;
  sends_today: number;
  daily_send_limit: number;
  next_scheduled_at: string | null;
  worker_heartbeat_at: string | null;
  worker_alive: boolean;
}

/** A ready-made sequence shape, resolved before anything is created. */
export interface SequenceTemplate {
  key: string;
  name: string;
  summary: string;
  best_for: string;
  total_days: number;
  steps: {
    position: number;
    strategy_name: string;
    wait_days: number;
    step_instructions: string | null;
  }[];
  missing_strategies: string[];
}

/** One live login, as shown in the Settings device list. */
export interface AuthSessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
  current: boolean;
}

// ---------- Gmail mailbox ----------

/** One email in the stored mailbox. Most have no prospect attached. */
export interface MailListItem {
  id: string;
  gmail_id: string;
  gmail_thread_id: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  subject: string | null;
  snippet: string | null;
  is_unread: boolean;
  is_sent: boolean;
  has_attachments: boolean;
  internal_date: string;
  prospect_id: string | null;
  prospect_name: string | null;
  /** True when this email also exists as a CRM pipeline row. */
  in_pipeline: boolean;
}

export interface MailDetail extends MailListItem {
  body_text: string | null;
  /** Server-sanitised. Never render body_html raw -- see html_sanitize.py. */
  body_html_safe: string;
  blocked_images: number;
  cc_addresses: string[];
  reply_to: string | null;
  attachments: { filename: string; mime_type: string; size: number }[];
  label_ids: string[];
}

export interface GmailStatus {
  connected: boolean;
  configured: boolean;
  email_address: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  history_id: number | null;
  total_emails: number;
  unread_count: number;
  full_sync_count: number;
}

export type MailFilter = "all" | "prospects" | "unread" | "sent";
