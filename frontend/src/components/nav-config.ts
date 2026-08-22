/** The one list of destinations, shared by the desktop sidebar and the
 *  mobile drawer so they cannot drift apart. */
export const NAV_LINKS = [
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
