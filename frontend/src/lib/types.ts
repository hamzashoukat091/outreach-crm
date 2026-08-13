export type LeadStatus =
  | "new"
  | "contacted"
  | "replied"
  | "qualified"
  | "won"
  | "lost"
  | "unsubscribed";

export type EnrollmentStatus = "active" | "paused" | "completed" | "stopped";
export type SendStatus = "scheduled" | "sent" | "failed" | "canceled";

export type ActivityType =
  | "created"
  | "status_changed"
  | "note"
  | "email_sent"
  | "email_failed"
  | "enrolled"
  | "unenrolled"
  | "replied";

export interface Lead {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  website: string | null;
  source: string | null;
  status: LeadStatus;
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadList {
  items: Lead[];
  total: number;
  page: number;
  page_size: number;
}

export interface SequenceStep {
  id: string;
  step_order: number;
  delay_days: number;
  subject: string;
  body: string;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  steps: SequenceStep[];
  active_enrollments: number;
}

export interface ScheduledSend {
  id: string;
  step_id: string;
  step_order: number | null;
  scheduled_for: string;
  status: SendStatus;
  rendered_subject: string | null;
  sent_at: string | null;
  error: string | null;
}

export interface Enrollment {
  id: string;
  lead_id: string;
  sequence_id: string;
  status: EnrollmentStatus;
  current_step: number;
  enrolled_at: string;
  sequence_name: string | null;
  lead_email: string | null;
  sends: ScheduledSend[];
}

export interface Activity {
  id: string;
  lead_id: string;
  type: ActivityType;
  summary: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface DashboardStats {
  total_leads: number;
  pipeline: { status: LeadStatus; count: number }[];
  active_enrollments: number;
  sends_last_7_days: number;
  sends_scheduled: number;
  reply_rate: number;
  upcoming: {
    id: string;
    lead_email: string;
    lead_name: string;
    sequence_name: string;
    subject: string;
    scheduled_for: string;
  }[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface EnrollResult {
  enrolled: number;
  skipped: number;
  reasons: Record<string, string>;
}
