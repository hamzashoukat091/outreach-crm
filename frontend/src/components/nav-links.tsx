"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/prospects", label: "Prospects" },
  { href: "/sequences", label: "Sequences" },
  { href: "/inbox", label: "Inbox" },
  // Approvals gates whether replies go out at all. It was reachable only by
  // typing the URL, which meant held emails could sit unseen indefinitely.
  { href: "/approvals", label: "Approvals", badge: "approvals" as const },
  { href: "/strategies", label: "Strategies" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
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
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {link.label}
              {count > 0 && (
                <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
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
