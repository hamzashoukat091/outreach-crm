"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { NAV_ICONS } from "@/components/nav-icons";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/prospects", label: "Prospects", icon: "prospects" },
  { href: "/sequences", label: "Sequences", icon: "sequences" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  // Approvals gates whether replies go out at all. It was reachable only by
  // typing the URL, which meant held emails could sit unseen indefinitely.
  { href: "/approvals", label: "Approvals", icon: "approvals", badge: "approvals" as const },
  { href: "/strategies", label: "Strategies", icon: "strategies" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function NavLinks() {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  // A count on the link is the whole point: without it you would have to open
  // the page to discover anything is waiting.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .automationAnalytics()
        .then((d) => !cancelled && setPending(d.pending_approvals))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <nav className="px-3 pb-3 lg:pb-6">
      <div className="flex gap-1 overflow-x-auto lg:flex-col">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const count = link.badge === "approvals" ? pending : 0;
          const Icon = NAV_ICONS[link.icon];

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex min-h-11 items-center gap-2.5 whitespace-nowrap
                rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ease-out
                lg:min-h-0 lg:py-2 ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
            >
              {/* An edge marker on the active item: the soft tint alone is easy
                  to lose against the sidebar at a glance. */}
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 hidden h-4 w-[3px] -translate-y-1/2
                    rounded-r-full bg-accent lg:block"
                />
              )}
              <span
                className={`transition-transform duration-150 ${
                  active ? "" : "group-hover:scale-105"
                }`}
              >
                {Icon && <Icon />}
              </span>
              {link.label}
              {count > 0 && (
                <span
                  className="tabular ml-auto inline-flex min-w-5 items-center justify-center
                    rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold
                    text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400"
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
