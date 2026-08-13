import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/nav-links";

export const metadata: Metadata = {
  title: "Outreach — Lead CRM",
  description: "Cold-outreach lead CRM with email sequencing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="border-b border-line bg-surface lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2.5 px-5 py-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
                O
              </div>
              <div>
                <Link
                  href="/prospects"
                  className="text-sm font-semibold tracking-tight text-ink"
                >
                  Outreach
                </Link>
                <p className="text-xs text-muted">Lead CRM</p>
              </div>
            </div>
            <NavLinks />
          </aside>

          <main className="flex-1 px-5 py-8 lg:px-10">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
