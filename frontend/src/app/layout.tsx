import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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

/* Only the shell lives here. The sidebar belongs to the (app) route group so
   the login page can render without it -- a gate drawn inside the thing it
   guards would look absurd. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
