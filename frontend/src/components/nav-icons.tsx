/* Inline 20px stroke icons, one family, uniform 1.6 stroke weight.
   Kept local rather than pulling an icon package in: eight glyphs do not
   justify a dependency, and these ship as markup with nothing to load. */

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-[18px] w-[18px] shrink-0" {...S}>
      {children}
    </svg>
  );
}

export const NAV_ICONS: Record<string, () => React.ReactElement> = {
  dashboard: () => (
    <Svg>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
    </Svg>
  ),
  prospects: () => (
    <Svg>
      <circle cx="7.5" cy="6.5" r="3" />
      <path d="M2 16.5c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5" />
      <path d="M13.5 4.2a3 3 0 010 5.6M15.5 12.3c1.6.6 2.5 1.9 2.5 3.7" />
    </Svg>
  ),
  sequences: () => (
    <Svg>
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="4.5" cy="15.5" r="2" />
      <circle cx="15.5" cy="10" r="2" />
      <path d="M6.5 4.5h4a3 3 0 013 3v.5M6.5 15.5h4a3 3 0 003-3V12" />
    </Svg>
  ),
  inbox: () => (
    <Svg>
      <path d="M2.5 10.5h4l1.2 2h4.6l1.2-2h4" />
      <path d="M4.2 4.5h11.6l1.7 6v5a2 2 0 01-2 2H4.5a2 2 0 01-2-2v-5z" />
    </Svg>
  ),
  mailbox: () => (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M3 6l7 5 7-5" />
    </>
  ),
  approvals: () => (
    <Svg>
      <path d="M10 2.5l6.5 2.6v4.6c0 3.6-2.6 6.6-6.5 7.8-3.9-1.2-6.5-4.2-6.5-7.8V5.1z" />
      <path d="M7.3 9.9l1.9 1.9 3.5-3.6" />
    </Svg>
  ),
  strategies: () => (
    <Svg>
      <path d="M10 2.5v15M4.5 6.5h11" />
      <path d="M4.5 6.5L2.5 12a2.6 2.6 0 004 0zM15.5 6.5L13.5 12a2.6 2.6 0 004 0z" />
    </Svg>
  ),
  analytics: () => (
    <Svg>
      <path d="M3 16.5V9M7.6 16.5V4.5M12.3 16.5v-5M17 16.5V7.5" />
    </Svg>
  ),
  settings: () => (
    <Svg>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 1.8l1.4 2.1 2.5-.5.5 2.5 2.1 1.4-1.3 2.2 1.3 2.2-2.1 1.4-.5 2.5-2.5-.5L10 18.2l-1.4-2.1-2.5.5-.5-2.5-2.1-1.4L4.8 10 3.5 7.8l2.1-1.4.5-2.5 2.5.5z" />
    </Svg>
  ),
};
