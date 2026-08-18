"use client";

/** The one place the app explains that the backend is unreachable.
 *
 *  This was pasted into nine page files, each rendering a bare "check
 *  `docker compose ps`" -- a correct instruction for whoever runs the stack
 *  and a dead end for anyone else. */
export function ApiError({ what = "This page" }: { what?: string }) {
  return (
    <div className="card animate-fade-in p-8 text-center sm:p-12">
      <div
        className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl
          bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-500/20
          dark:bg-rose-950/50 dark:text-rose-400"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
          <path d="M10 6.5v4.2" strokeLinecap="round" />
          <circle cx="10" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="7.5" />
        </svg>
      </div>

      <p className="text-base font-medium text-ink">{what} can&apos;t load right now</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
        The server isn&apos;t responding. Your data is safe — nothing has been
        lost, and the page will work again once the connection is back.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {/* A plain reload: the overwhelmingly common fix is that the backend
            was still starting up. */}
        <button onClick={() => window.location.reload()} className="btn-primary h-9">
          Try again
        </button>
      </div>

      <details className="group mt-5 text-left">
        <summary className="cursor-pointer list-none text-center text-xs text-muted hover:text-ink">
          <span className="group-open:hidden">Technical details</span>
          <span className="hidden group-open:inline">Hide details</span>
        </summary>
        <p className="mt-2 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          The web app could not reach the API service. If you are running this
          locally, check the containers are up with{" "}
          <code className="rounded bg-canvas px-1 py-0.5 font-mono">docker compose ps</code>{" "}
          and that the <code className="rounded bg-canvas px-1 py-0.5 font-mono">api</code>{" "}
          service is healthy.
        </p>
      </details>
    </div>
  );
}
