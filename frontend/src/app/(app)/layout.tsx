import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { LiveIndicator } from "@/components/live-indicator";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out";

/* Sidebar on desktop, compact header + scrolling tab strip on mobile.
 *
 * The sidebar used to stack whole on small screens -- logo block, eight nav
 * items, live indicator and sign-out -- which pushed real content most of the
 * way down the first screen on every page. On mobile the same pieces are
 * rearranged rather than hidden: the brand row carries the live state and
 * sign-out inline, and navigation becomes a horizontally scrolling strip. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <aside
        className="sticky top-0 z-30 flex flex-col border-b border-line bg-surface/85
          backdrop-blur-xl lg:h-[100dvh] lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r
          pt-[env(safe-area-inset-top)] lg:pt-0"
      >
        {/* One row on mobile: brand, scrolling nav, status. Two rows cost
            17% of a phone screen on every page. On desktop this reverts to a
            stacked brand block above a vertical nav. */}
        <div className="flex items-center gap-2 px-3 lg:flex-col lg:items-stretch lg:gap-0 lg:px-0">
          <Link
            href="/prospects"
            aria-label="Outreach home"
            className="flex shrink-0 items-center gap-2.5 py-2 lg:px-5 lg:py-5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-white shadow-glow lg:h-9 lg:w-9 lg:rounded-[10px]">
              <Logo className="h-5 w-5 lg:h-[22px] lg:w-[22px]" />
            </span>
            {/* The wordmark is redundant beside the mark on a phone and the
                row has no width to spare. */}
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-sm font-semibold tracking-tight text-ink">
                Outreach
              </span>
              <span className="block text-xs text-muted">Outreach CRM</span>
            </span>
          </Link>

          {/* min-w-0 lets the strip shrink and scroll instead of pushing the
              status controls off the edge. */}
          <div className="min-w-0 flex-1 lg:w-full lg:flex-none">
            <NavLinks />
          </div>

          <div className="flex shrink-0 items-center gap-1 lg:hidden">
            <LiveIndicator compact />
            <SignOutButton compact />
          </div>
        </div>

        <div className="mt-auto hidden lg:block">
          <LiveIndicator />
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
