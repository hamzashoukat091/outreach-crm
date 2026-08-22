"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { useConnectivity } from "@/components/connectivity";

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const { online } = useConnectivity();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.login(username.trim(), password);
      // Land where the gate intercepted you, or at the start.
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      /* Distinguish the causes. A phone with no signal and a mistyped
         password both threw the same sentence before, which sent you
         hunting for a typo that was never there. */
      if (!navigator.onLine) {
        setError("You're offline. Reconnect and try again.");
      } else {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Could not reach the server. Check your connection and try again.",
        );
      }
      setPending(false);
    }
  }

  return (
    <div
      /* Centred, with the safe-area insets as padding rather than as a top
         offset. justify-center plus min-h means the card sits in the middle
         of whatever height the viewport actually has, and 100dvh shrinks
         when the keyboard opens, so the card rides up with it instead of
         being pushed off the bottom. py- (not pt-) keeps it centred within
         the padded box; padding only one side would re-introduce the drift
         that made it look pinned to the top. */
      className="flex min-h-[100dvh] flex-col justify-center px-5
        py-[max(2rem,env(safe-area-inset-top),env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-solid text-white shadow-glow">
            <Logo className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Outreach</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your CRM</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="input pr-16"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs text-muted hover:text-ink"
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-400/25">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !online}
            className="btn-primary h-10 w-full"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>

          {/* A disabled button with no stated reason reads as a broken app. */}
          {!online && (
            <p role="status" className="text-center text-xs text-muted">
              You&rsquo;re offline. Signing in needs a connection.
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          Sessions last 7 days of inactivity. Manage devices in Settings.
        </p>
      </div>
    </div>
  );
}

/* useSearchParams needs a Suspense boundary in the app router. */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
