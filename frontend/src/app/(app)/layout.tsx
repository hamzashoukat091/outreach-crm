import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { LiveIndicator } from "@/components/live-indicator";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="sticky top-0 z-30 flex flex-col border-b border-line bg-surface/80 backdrop-blur-xl lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-solid text-white shadow-glow">
            <Logo className="h-[22px] w-[22px]" />
          </div>
          <div>
            <Link
              href="/prospects"
              className="text-sm font-semibold tracking-tight text-ink"
            >
              Outreach
            </Link>
            <p className="text-xs text-muted">Outreach CRM</p>
          </div>
        </div>
        <NavLinks />
        {/* Pinned to the foot of the sidebar: the state you should be able
            to confirm without navigating anywhere. */}
        <div className="mt-auto">
          <LiveIndicator />
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 px-5 py-8 lg:px-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
