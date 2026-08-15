"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  resetAutomationSettingsAction,
  saveAutomationSettingsAction,
  saveSenderFactsAction,
} from "@/app/automation-actions";
import type {
  AutomationSettings,
  SenderFactField,
  SenderFacts,
  SettingsSection,
} from "@/lib/types";
import type { ReplySituation } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

// ISO weekday numbers, matching the backend: 1 = Monday … 7 = Sunday.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

/** The API sends times as "HH:MM:SS"; <input type="time"> wants "HH:MM". */
const toHHMM = (t: string) => t.slice(0, 5);

const ALL_SITUATIONS: ReplySituation[] = [
  "interested",
  "question",
  "objection",
  "not_now",
  "referral",
  "not_interested",
  "unsubscribe",
  "auto_reply",
  "unclear",
];

/** Card shell shared by every section: title, body, save/reset footer. */
function Section({
  title,
  description,
  children,
  onSave,
  onReset,
  pending,
  saveLabel = "Save",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onSave?: () => void;
  onReset?: () => void;
  pending: boolean;
  saveLabel?: string;
}) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
      {(onSave || onReset) && (
        <div
          className={`mt-4 flex items-center gap-2 ${
            // A lone reset link doesn't need a rule above it -- the divider
            // reads as a footer only when there's a primary action to divide.
            onSave ? "border-t border-line pt-4" : "pt-1"
          }`}
        >
          {onSave && (
            <button onClick={onSave} disabled={pending} className="btn-primary h-9">
              {pending ? "Saving…" : saveLabel}
            </button>
          )}
          {onReset && (
            <button
              onClick={onReset}
              disabled={pending}
              className="btn-ghost ml-auto h-9 text-xs"
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function useSettingsSave() {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function save(payload: Parameters<typeof saveAutomationSettingsAction>[0]) {
    startTransition(async () => {
      const result = await saveAutomationSettingsAction(payload);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function reset(section: SettingsSection, label: string) {
    if (!window.confirm(`Reset ${label} to defaults?`)) return;
    startTransition(async () => {
      const result = await resetAutomationSettingsAction(section);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return { pending, toast, show, save, reset, startTransition, router };
}

// ---------- Safety ----------

function SafetySection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save, reset } = useSettingsSave();

  function toggleDryRun() {
    if (settings.dry_run) {
      // Turning OFF means the next worker tick delivers for real.
      if (!window.confirm("Real emails will be sent to real people. Continue?")) return;
    }
    save({ dry_run: !settings.dry_run });
  }

  return (
    <>
      <Section
        title="Safety"
        description="The two switches that decide whether anything actually leaves."
        pending={pending}
        onReset={() => reset("safety", "the safety switches")}
      >
        {/* Two switch rows of equal weight. Neither is styled as an alarm
            while idle -- the status strip above already carries the state, and
            a permanently red control stops reading as a warning. */}
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Dry run</p>
              <p className="mt-0.5 text-xs text-muted">
                {settings.dry_run
                  ? "Drafts, schedules and logs everything — delivers nothing."
                  : "Live. Approved emails are delivered to real inboxes."}
              </p>
            </div>
            {/* A button, not a checkbox: this row and the one below are the
                same kind of switch, and turning dry run off opens a confirm
                dialog -- which a checkbox's instant-toggle affordance lies
                about. aria-pressed keeps the on/off state announced. */}
            <button
              onClick={toggleDryRun}
              disabled={pending}
              aria-pressed={settings.dry_run}
              className={`h-9 shrink-0 ${
                settings.dry_run ? "btn-secondary" : "btn-primary"
              }`}
            >
              {settings.dry_run ? "Turn off — go live" : "Turn on dry run"}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Sending</p>
              <p className="mt-0.5 text-xs text-muted">
                {settings.sending_paused
                  ? "Paused. Nothing leaves until you resume — drafting continues."
                  : "Running. Due emails go out inside the window below."}
              </p>
            </div>
            <button
              onClick={() => save({ sending_paused: !settings.sending_paused })}
              disabled={pending}
              className={`h-9 shrink-0 ${
                settings.sending_paused ? "btn-primary" : "btn-secondary"
              }`}
            >
              {settings.sending_paused ? "Resume sending" : "Pause sending"}
            </button>
          </div>
        </div>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- Schedule ----------

function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const zones = useMemo<string[]>(() => {
    try {
      const list = Intl.supportedValuesOf("timeZone");
      return list.includes(value) ? list : [value, ...list];
    } catch {
      return [value];
    }
  }, [value]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Timezone"
      className="input"
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}

function ScheduleSection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save, reset } = useSettingsSave();
  const [form, setForm] = useState({
    window_start: toHHMM(settings.send_window_start),
    window_end: toHHMM(settings.send_window_end),
    send_days: settings.send_days,
    timezone: settings.timezone,
    default_delay_days: settings.default_delay_days,
    default_send_time: toHHMM(settings.default_send_time),
  });

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      send_days: f.send_days.includes(day)
        ? f.send_days.filter((d) => d !== day)
        : [...f.send_days, day].sort((a, b) => a - b),
    }));
  }

  return (
    <>
      <Section
        title="Schedule"
        description="When the engine is allowed to send, and how long enrollment drafts wait by default."
        pending={pending}
        onSave={() =>
          save({
            // Empty time fields are omitted: the backend treats absent as "keep".
            ...(form.window_start ? { send_window_start: form.window_start } : {}),
            ...(form.window_end ? { send_window_end: form.window_end } : {}),
            send_days: form.send_days,
            timezone: form.timezone,
            default_delay_days: form.default_delay_days,
            ...(form.default_send_time
              ? { default_send_time: form.default_send_time }
              : {}),
          })
        }
        onReset={() => reset("schedule", "the schedule")}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label text-xs" htmlFor="win-start">Window opens</label>
            <input
              id="win-start"
              type="time"
              value={form.window_start}
              onChange={(e) => setForm((f) => ({ ...f, window_start: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="win-end">Window closes</label>
            <input
              id="win-end"
              type="time"
              value={form.window_end}
              onChange={(e) => setForm((f) => ({ ...f, window_end: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs">Timezone</label>
            <TimezoneSelect
              value={form.timezone}
              onChange={(tz) => setForm((f) => ({ ...f, timezone: tz }))}
            />
          </div>
        </div>

        <div>
          <p className="label text-xs">Send days</p>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.send_days.includes(day.value)}
                  onChange={() => toggleDay(day.value)}
                  className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label text-xs" htmlFor="delay-days">
              Default delay (days)
            </label>
            <input
              id="delay-days"
              type="number"
              min={0}
              max={30}
              value={form.default_delay_days}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_delay_days: Number(e.target.value) }))
              }
              className="input"
            />
            <p className="mt-1 text-xs text-muted">
              Used by &quot;draft now, send later&quot; enrollments.
            </p>
          </div>
          <div>
            <label className="label text-xs" htmlFor="default-time">
              Default send time
            </label>
            <input
              id="default-time"
              type="time"
              value={form.default_send_time}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_send_time: e.target.value }))
              }
              className="input"
            />
            <p className="mt-1 text-xs text-muted">
              Used when a step doesn&apos;t set its own send time.
            </p>
          </div>
        </div>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- Limits ----------

function LimitsSection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save, reset } = useSettingsSave();
  const [hourly, setHourly] = useState(settings.hourly_send_limit);
  const [daily, setDaily] = useState(settings.daily_send_limit);

  return (
    <>
      <Section
        title="Limits"
        description="Hard caps on volume. The engine stops sending when either is hit."
        pending={pending}
        onSave={() => save({ hourly_send_limit: hourly, daily_send_limit: daily })}
        onReset={() => reset("limits", "the sending limits")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label text-xs" htmlFor="hourly">Per hour</label>
            <input
              id="hourly"
              type="number"
              min={1}
              value={hourly}
              onChange={(e) => setHourly(Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="daily">Per day</label>
            <input
              id="daily"
              type="number"
              min={1}
              value={daily}
              onChange={(e) => setDaily(Number(e.target.value))}
              className="input"
            />
          </div>
        </div>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- Replies ----------

function RepliesSection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save, reset } = useSettingsSave();
  const [form, setForm] = useState({
    auto_reply_enabled: settings.auto_reply_enabled,
    min_confidence_to_send: settings.min_confidence_to_send,
    always_review_first_reply: settings.always_review_first_reply,
    escalate_situations: settings.escalate_situations,
  });

  function toggleSituation(situation: ReplySituation) {
    setForm((f) => ({
      ...f,
      escalate_situations: f.escalate_situations.includes(situation)
        ? f.escalate_situations.filter((s) => s !== situation)
        : [...f.escalate_situations, situation],
    }));
  }

  return (
    <>
      <Section
        title="Replies"
        description="How much the engine may answer on its own before pulling you in."
        pending={pending}
        onSave={() => save(form)}
        onReset={() => reset("replies", "the reply rules")}
      >
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.auto_reply_enabled}
            onChange={(e) =>
              setForm((f) => ({ ...f, auto_reply_enabled: e.target.checked }))
            }
            className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
          />
          Draft replies to inbound emails automatically
        </label>

        <div>
          <label className="label text-xs" htmlFor="min-conf">
            Minimum classification confidence: {form.min_confidence_to_send}%
          </label>
          <div className="flex items-center gap-3">
            <input
              id="min-conf"
              type="range"
              min={0}
              max={100}
              value={form.min_confidence_to_send}
              onChange={(e) =>
                setForm((f) => ({ ...f, min_confidence_to_send: Number(e.target.value) }))
              }
              className="flex-1 accent-[rgb(var(--accent))]"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={form.min_confidence_to_send}
              onChange={(e) =>
                setForm((f) => ({ ...f, min_confidence_to_send: Number(e.target.value) }))
              }
              aria-label="Minimum confidence"
              className="input w-20"
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Below this, the reply is held for your approval instead of sent.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.always_review_first_reply}
            onChange={(e) =>
              setForm((f) => ({ ...f, always_review_first_reply: e.target.checked }))
            }
            className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
          />
          Always hold the first reply in every conversation for review
        </label>

        <div>
          <p className="label text-xs">Always escalate these situations</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_SITUATIONS.map((situation) => (
              <label key={situation} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.escalate_situations.includes(situation)}
                  onChange={() => toggleSituation(situation)}
                  className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                />
                {situation.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- SMTP / IMAP ----------

function PasswordField({
  id,
  hasSaved,
  value,
  touched,
  onChange,
}: {
  id: string;
  hasSaved: boolean;
  value: string;
  touched: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label text-xs" htmlFor={id}>Password</label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasSaved ? "••••• saved" : ""}
        autoComplete="new-password"
        className="input"
      />
      <p className="mt-1 text-xs text-muted">
        {hasSaved
          ? touched && value === ""
            ? "Saving will clear the stored password."
            : "Leave untouched to keep the stored password."
          : "Not set."}
      </p>
    </div>
  );
}

function SmtpSection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save } = useSettingsSave();
  const [form, setForm] = useState({
    smtp_host: settings.smtp_host ?? "",
    smtp_port: settings.smtp_port !== null ? String(settings.smtp_port) : "",
    smtp_username: settings.smtp_username ?? "",
    smtp_use_tls: settings.smtp_use_tls,
    from_address: settings.from_address ?? "",
    from_name: settings.from_name ?? "",
    reply_to: settings.reply_to ?? "",
  });
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);

  function submit() {
    save({
      smtp_host: form.smtp_host.trim() || null,
      smtp_port: form.smtp_port === "" ? null : Number(form.smtp_port),
      smtp_username: form.smtp_username.trim() || null,
      smtp_use_tls: form.smtp_use_tls,
      from_address: form.from_address.trim() || null,
      from_name: form.from_name.trim() || null,
      reply_to: form.reply_to.trim() || null,
      // Absent keeps the stored password; empty string clears it.
      ...(passwordTouched ? { smtp_password: password } : {}),
    });
  }

  return (
    <>
      <Section
        title="Outbound email (SMTP)"
        description="Where automated emails are actually sent from."
        pending={pending}
        onSave={submit}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label text-xs" htmlFor="smtp-host">Host</label>
            <input
              id="smtp-host"
              value={form.smtp_host}
              onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))}
              placeholder="smtp.example.com"
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="smtp-port">Port</label>
            <input
              id="smtp-port"
              type="number"
              value={form.smtp_port}
              onChange={(e) => setForm((f) => ({ ...f, smtp_port: e.target.value }))}
              placeholder="587"
              className="input"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label text-xs" htmlFor="smtp-user">Username</label>
            <input
              id="smtp-user"
              value={form.smtp_username}
              onChange={(e) => setForm((f) => ({ ...f, smtp_username: e.target.value }))}
              className="input"
            />
          </div>
          <PasswordField
            id="smtp-pass"
            hasSaved={settings.has_smtp_password}
            value={password}
            touched={passwordTouched}
            onChange={(v) => {
              setPassword(v);
              setPasswordTouched(true);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.smtp_use_tls}
            onChange={(e) => setForm((f) => ({ ...f, smtp_use_tls: e.target.checked }))}
            className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
          />
          Use TLS
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label text-xs" htmlFor="from-addr">From address</label>
            <input
              id="from-addr"
              value={form.from_address}
              onChange={(e) => setForm((f) => ({ ...f, from_address: e.target.value }))}
              placeholder="you@yourdomain.com"
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="from-name">From name</label>
            <input
              id="from-name"
              value={form.from_name}
              onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="reply-to">Reply-to</label>
            <input
              id="reply-to"
              value={form.reply_to}
              onChange={(e) => setForm((f) => ({ ...f, reply_to: e.target.value }))}
              className="input"
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Leave host empty to keep using Mailpit (local test inbox).
        </p>
      </Section>
      <Toast state={toast} />
    </>
  );
}

function ImapSection({ settings }: { settings: AutomationSettings }) {
  const { pending, toast, save } = useSettingsSave();
  const [form, setForm] = useState({
    imap_host: settings.imap_host ?? "",
    imap_port: settings.imap_port !== null ? String(settings.imap_port) : "",
    imap_username: settings.imap_username ?? "",
    imap_use_ssl: settings.imap_use_ssl,
    imap_folder: settings.imap_folder ?? "",
    imap_poll_seconds: settings.imap_poll_seconds,
  });
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);

  function submit() {
    save({
      imap_host: form.imap_host.trim() || null,
      imap_port: form.imap_port === "" ? null : Number(form.imap_port),
      imap_username: form.imap_username.trim() || null,
      imap_use_ssl: form.imap_use_ssl,
      // Absent keeps the stored folder; the column itself is non-null.
      ...(form.imap_folder.trim() ? { imap_folder: form.imap_folder.trim() } : {}),
      imap_poll_seconds: form.imap_poll_seconds,
      ...(passwordTouched ? { imap_password: password } : {}),
    });
  }

  return (
    <>
      <Section
        title="Inbound email (IMAP)"
        description="Where replies are read from."
        pending={pending}
        onSave={submit}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label text-xs" htmlFor="imap-host">Host</label>
            <input
              id="imap-host"
              value={form.imap_host}
              onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))}
              placeholder="imap.example.com"
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="imap-port">Port</label>
            <input
              id="imap-port"
              type="number"
              value={form.imap_port}
              onChange={(e) => setForm((f) => ({ ...f, imap_port: e.target.value }))}
              placeholder="993"
              className="input"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label text-xs" htmlFor="imap-user">Username</label>
            <input
              id="imap-user"
              value={form.imap_username}
              onChange={(e) => setForm((f) => ({ ...f, imap_username: e.target.value }))}
              className="input"
            />
          </div>
          <PasswordField
            id="imap-pass"
            hasSaved={settings.has_imap_password}
            value={password}
            touched={passwordTouched}
            onChange={(v) => {
              setPassword(v);
              setPasswordTouched(true);
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label text-xs" htmlFor="imap-folder">Folder</label>
            <input
              id="imap-folder"
              value={form.imap_folder}
              onChange={(e) => setForm((f) => ({ ...f, imap_folder: e.target.value }))}
              placeholder="INBOX"
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="imap-poll">Poll every (seconds)</label>
            <input
              id="imap-poll"
              type="number"
              min={10}
              value={form.imap_poll_seconds}
              onChange={(e) =>
                setForm((f) => ({ ...f, imap_poll_seconds: Number(e.target.value) }))
              }
              className="input"
            />
          </div>
          <div className="flex items-end pb-2.5">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.imap_use_ssl}
                onChange={(e) => setForm((f) => ({ ...f, imap_use_ssl: e.target.checked }))}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
              />
              Use SSL
            </label>
          </div>
        </div>
        <p className="text-xs text-muted">
          Leave host empty to keep using Mailpit (local test inbox).
        </p>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- Sender facts ----------

const FACT_FIELDS: {
  name: SenderFactField;
  label: string;
  hint?: string;
  textarea?: boolean;
}[] = [
  { name: "rates", label: "Rates", textarea: true },
  { name: "availability", label: "Availability", textarea: true },
  { name: "tech_stack", label: "Tech stack", textarea: true },
  { name: "process", label: "How you work", textarea: true },
  { name: "booking_link", label: "Booking link" },
  { name: "portfolio_link", label: "Portfolio link" },
  {
    name: "do_not_answer",
    label: "Do not answer",
    hint: "Topics Claude must never answer — it will hold the reply for you instead.",
    textarea: true,
  },
  { name: "extra_facts", label: "Anything else", textarea: true },
];

function SenderFactsSection({ facts }: { facts: SenderFacts }) {
  // The API returns null for unset facts; inputs want strings.
  const [form, setForm] = useState<Record<SenderFactField, string>>(() =>
    Object.fromEntries(
      FACT_FIELDS.map((field) => [field.name, facts[field.name] ?? ""]),
    ) as Record<SenderFactField, string>,
  );
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const result = await saveSenderFactsAction(form);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <Section
        title="Sender facts"
        description="Claude answers questions in replies ONLY from these facts. Anything not covered gets held for your approval."
        pending={pending}
        onSave={submit}
        saveLabel="Save facts"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {FACT_FIELDS.map((field) => (
            <div
              key={field.name}
              className={field.textarea ? "sm:col-span-1" : "sm:col-span-1"}
            >
              <label className="label text-xs" htmlFor={`fact-${field.name}`}>
                {field.label}
              </label>
              {field.textarea ? (
                <textarea
                  id={`fact-${field.name}`}
                  rows={3}
                  value={form[field.name]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [field.name]: e.target.value }))
                  }
                  className="input resize-y text-sm"
                />
              ) : (
                <input
                  id={`fact-${field.name}`}
                  value={form[field.name]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [field.name]: e.target.value }))
                  }
                  className="input"
                />
              )}
              {field.hint && <p className="mt-1 text-xs text-muted">{field.hint}</p>}
            </div>
          ))}
        </div>
      </Section>
      <Toast state={toast} />
    </>
  );
}

// ---------- Panel ----------

export function AutomationSettingsPanel({
  settings,
  facts,
}: {
  settings: AutomationSettings;
  facts: SenderFacts;
}) {
  // Keying each section by its own slice of the settings remounts it with
  // fresh values after a save or reset, without clobbering edits elsewhere.
  const scheduleKey = JSON.stringify([
    settings.send_window_start,
    settings.send_window_end,
    settings.send_days,
    settings.timezone,
    settings.default_delay_days,
    settings.default_send_time,
  ]);
  const limitsKey = JSON.stringify([
    settings.hourly_send_limit,
    settings.daily_send_limit,
  ]);
  const repliesKey = JSON.stringify([
    settings.auto_reply_enabled,
    settings.min_confidence_to_send,
    settings.always_review_first_reply,
    settings.escalate_situations,
  ]);
  const smtpKey = JSON.stringify([
    settings.smtp_host,
    settings.smtp_port,
    settings.smtp_username,
    settings.has_smtp_password,
    settings.smtp_use_tls,
    settings.from_address,
    settings.from_name,
    settings.reply_to,
  ]);
  const imapKey = JSON.stringify([
    settings.imap_host,
    settings.imap_port,
    settings.imap_username,
    settings.has_imap_password,
    settings.imap_use_ssl,
    settings.imap_folder,
    settings.imap_poll_seconds,
  ]);

  return (
    <div className="space-y-6">
      <SafetySection settings={settings} />
      <ScheduleSection key={`s-${scheduleKey}`} settings={settings} />
      <LimitsSection key={`l-${limitsKey}`} settings={settings} />
      <RepliesSection key={`r-${repliesKey}`} settings={settings} />
      <SmtpSection key={`m-${smtpKey}`} settings={settings} />
      <ImapSection key={`i-${imapKey}`} settings={settings} />
      <SenderFactsSection key={`f-${JSON.stringify(facts)}`} facts={facts} />
    </div>
  );
}
