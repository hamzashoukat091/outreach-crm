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
        <div className="flex items-center gap-2.5 px-4 py-3 lg:px-5 lg:py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-solid text-white shadow-glow">
            <Logo className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <Link
              href="/prospects"
              className="block truncate text-sm font-semibold tracking-tight text-ink"
            >
              Outreach
            </Link>
            <p className="hidden text-xs text-muted lg:block">Outreach CRM</p>
          </div>

          {/* On mobile these ride the brand row instead of consuming two more
              stacked blocks below the nav. */}
          <div className="ml-auto flex items-center gap-1 lg:hidden">
            <LiveIndicator compact />
            <SignOutButton compact />
          </div>
        </div>

        <NavLinks />

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
