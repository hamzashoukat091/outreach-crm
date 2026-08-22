import type { MetadataRoute } from "next";

/** The install manifest.
 *
 *  Typed rather than a static public/manifest.json so a bad field is a build
 *  error instead of a silently unreadable install. Next serves it at
 *  /manifest.webmanifest and links it from every page automatically.
 *
 *  Note on icons: `any` and `maskable` are separate entries on purpose. A
 *  single icon marked `"any maskable"` is the common mistake -- Android then
 *  applies its circular crop to artwork that was drawn to fill the square and
 *  shaves the edges off. The maskable files carry ~28% padding so the crop
 *  only ever eats empty ground.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Outreach — Cold outreach CRM",
    short_name: "Outreach",
    description: "Cold-outreach CRM with AI drafting and automated sequences.",
    // start_url and scope are relative so the app installs correctly whether
    // it is served from outreach.openval.ai or a local port.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // Matches --bg in globals.css. The splash screen paints this before the
    // first frame, so a mismatch shows as a flash of the wrong colour.
    background_color: "#f8fafc",
    theme_color: "#4338ca",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home screen icon to jump straight to the two screens
    // that carry pending work.
    shortcuts: [
      {
        name: "Approvals",
        short_name: "Approvals",
        description: "Drafts waiting on you",
        url: "/approvals",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Inbox",
        short_name: "Inbox",
        description: "Replies from prospects",
        url: "/inbox",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
