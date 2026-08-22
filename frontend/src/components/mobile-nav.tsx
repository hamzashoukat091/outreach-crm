"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { NAV_ICONS } from "@/components/nav-icons";
import { NAV_LINKS } from "@/components/nav-config";

/** Slide-in drawer for the phone.
 *
 *  A horizontally scrolling strip was the wrong shape: half the destinations
 *  sat off-screen with nothing to say so, which makes them effectively
 *  missing rather than merely further away. A drawer shows all eight at once
 *  the moment it opens, which is what navigation has to do. */
export function MobileNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Any navigation closes it -- otherwise the drawer covers the page you
  // just asked for.
  useEffect(() => setOpen(false), [pathname]);

  // A drawer over a scrollable page that still scrolls underneath feels
  // broken, and Escape is the expected way out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Portals need the DOM, so render nothing on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const overlay = (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] animate-slide-in
          flex-col border-r border-line bg-surface shadow-pop
          pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between px-4 py-4">
          <p className="text-sm font-semibold tracking-tight text-ink">Outreach</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="btn-ghost min-h-11 w-11 px-0"
          >
            <svg viewBox="0 0 20 20" aria-hidden className="h-5 w-5" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const active = pathname.startsWith(link.href);
              const Icon = NAV_ICONS[link.icon];
              const count = link.badge === "approvals" ? pendingApprovals : 0;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm
                    font-medium transition-colors ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-muted active:bg-surface-2"
                    }`}
                >
                  {Icon && <Icon />}
                  {link.label}
                  {count > 0 && (
                    <span className="tabular ml-auto inline-flex min-w-5 items-center
                      justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs
                      font-semibold text-amber-600 ring-1 ring-inset ring-amber-500/25
                      dark:text-amber-400">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="btn-ghost min-h-11 w-11 shrink-0 px-0 lg:hidden"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        </svg>
        {/* The count has to be visible with the drawer shut, or you would
            have to open it to learn anything is waiting. */}
        {pendingApprovals > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-surface" />
        )}
      </button>

      {open && mounted && createPortal(overlay, document.body)}
    </>
  );
}
