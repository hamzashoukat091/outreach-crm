import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { LiveIndicator } from "@/components/live-indicator";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { OfflineBanner, OfflineGuard } from "@/components/offline-guard";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { SignOutButton } from "@/components/sign-out";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/* Sidebar on desktop, single compact bar plus a drawer on mobile.
 *
 * The mobile bar is one row: menu button, logo, then live state and sign-out
 * pushed right. Navigation lives in a drawer rather than a scrolling strip --
 * a strip put half the destinations off-screen with nothing to indicate they
 * existed, which makes them missing rather than merely further away. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Fetched here so the closed drawer can still show that approvals are
  // waiting; the count is the whole reason that link earns a badge.
  const pending = await api
    .automationAnalytics()
    .then((d) => d.pending_approvals)
    .catch(() => 0);

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <aside
        className="sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-line
          bg-surface/85 px-2 backdrop-blur-xl pt-[env(safe-area-inset-top)]
          lg:h-full lg:w-60 lg:flex-col lg:items-stretch lg:gap-0 lg:border-b-0
          lg:border-r lg:px-0 lg:pt-0"
      >
        <MobileNav pendingApprovals={pending} />

        <Link
          href="/prospects"
          aria-label="Outreach home"
          className="flex min-w-0 shrink-0 items-center gap-2.5 py-2 lg:px-5 lg:py-5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-white shadow-glow lg:h-9 lg:w-9 lg:rounded-[10px]">
            <Logo className="h-5 w-5 lg:h-[22px] lg:w-[22px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-ink">
              Outreach
            </span>
            <span className="hidden text-xs text-muted lg:block">Outreach CRM</span>
          </span>
        </Link>

        <NavLinks />

        {/* Right-aligned on the mobile bar; stacked at the foot on desktop. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0 lg:mt-auto lg:block">
          <span className="lg:hidden">
            <LiveIndicator compact />
          </span>
          <span className="hidden lg:block">
            <LiveIndicator />
          </span>
          <span className="lg:hidden">
            <SignOutButton compact />
          </span>
          <span className="hidden lg:block">
            <SignOutButton />
          </span>
        </div>
      </aside>

      {/* The banner sits above the content and outside the guard; navigation
          and sign-out stay live offline, because being stuck on a page you
          cannot leave is worse than the outage itself. Only the page body --
          where every mutating button lives -- is disabled. */}
      <div data-scroll-root className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto">
        <PullToRefresh />
        <OfflineBanner />
        <main className="flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5 lg:px-10 lg:py-8">
          <OfflineGuard>
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </OfflineGuard>
        </main>
      </div>
    </div>
  );
}
