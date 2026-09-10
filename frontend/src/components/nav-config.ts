/** The one list of destinations, shared by the desktop sidebar and the
 *  mobile drawer so they cannot drift apart. */
export const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/prospects", label: "Prospects", icon: "prospects" },
  { href: "/sequences", label: "Sequences", icon: "sequences" },
  // Two mail pages, and the labels have to carry the difference: Mailbox is
  // the Gmail account (every email), Conversations is the CRM pipeline (only
  // prospects who replied, with classification and drafted replies).
  { href: "/mailbox", label: "Mailbox", icon: "mailbox" },
  { href: "/inbox", label: "Conversations", icon: "inbox" },
  // Approvals gates whether replies go out at all. It was reachable only by
  // typing the URL, which meant held emails could sit unseen indefinitely.
  { href: "/approvals", label: "Approvals", icon: "approvals", badge: "approvals" as const },
  { href: "/strategies", label: "Strategies", icon: "strategies" },
  // The step before Prospects: a sourcing run produces the CSV that gets
  // imported, so the prompts belong in the app rather than in a file on one
  // machine.
  { href: "/prompts", label: "Prompts", icon: "prompts" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
