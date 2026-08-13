"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The prospect + AI flow is the primary workflow; the automated sequence
// engine stays available underneath it.
const GROUPS = [
  {
    label: "Outreach",
    links: [
      { href: "/prospects", label: "Prospects" },
      { href: "/outbox", label: "Outbox" },
      { href: "/strategies", label: "Strategies" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Sequences",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/leads", label: "Leads" },
      { href: "/sequences", label: "Templates" },
      { href: "/queue", label: "Send queue" },
    ],
  },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="px-3 pb-3 lg:pb-6">
      {GROUPS.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="hidden px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted lg:block">
            {group.label}
          </p>
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {group.links.map((link) => {
              const active =
                link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
