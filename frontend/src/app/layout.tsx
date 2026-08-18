import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavLinks } from "@/components/nav-links";
import { LiveIndicator } from "@/components/live-indicator";
import { Logo } from "@/components/logo";

/* The app declared font-sans: var(--font-sans) but never defined it, so every
   screen fell through to the browser's generic default -- Times New Roman in
   Chromium. Inter is loaded and self-hosted by next/font, which also avoids
   the layout shift a webfont link would cause. */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  // A template so every page names itself in the tab, which matters most when
  // several are open at once.
  title: {
    default: "Outreach — Cold outreach CRM",
    template: "%s · Outreach",
  },
  description: "Cold-outreach CRM with AI drafting and automated sequences.",
  applicationName: "Outreach",
};

// themeColor belongs on the viewport export in Next 15, not metadata. Paints
// the browser chrome to match the canvas in each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#090b10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
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
            </div>
          </aside>

          <main className="flex-1 px-5 py-8 lg:px-10">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
