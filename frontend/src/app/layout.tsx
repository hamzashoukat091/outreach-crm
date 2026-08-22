import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ConnectivityProvider } from "@/components/connectivity";
import { IosInstallHint, ServiceWorkerRegistrar } from "@/components/pwa";
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
  // Next links the manifest from app/manifest.ts automatically; these are the
  // iOS-only bits it does not infer. `capable` is what makes an installed
  // icon open without Safari's chrome on versions before iOS 26.
  appleWebApp: {
    capable: true,
    title: "Outreach",
    // "default" keeps the status bar legible in both themes; "black-translucent"
    // would push content under the clock.
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Stops iOS from turning phone-like digits in prospect data into call links.
  formatDetection: { telephone: false },
};

// themeColor belongs on the viewport export in Next 15, not metadata. Paints
// the browser chrome to match the canvas in each theme.
export const viewport: Viewport = {
  // viewport-fit=cover lets the layout paint into the notch/home-indicator
  // area; the safe-area insets already in the layouts keep content clear of it.
  viewportFit: "cover",
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
      <body className="min-h-[100dvh] font-sans antialiased">
        {/* Wraps everything, including /login: signing in needs the server
            just as much as the rest of the app does. */}
        <ConnectivityProvider>
          {children}
          <ServiceWorkerRegistrar />
          <IosInstallHint />
        </ConnectivityProvider>
      </body>
    </html>
  );
}
