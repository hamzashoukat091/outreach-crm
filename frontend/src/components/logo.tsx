/** The Outreach mark: a sequence path that ends in a send.
 *
 *  Three nodes joined by an S-curve, with a paper plane leaving the last one.
 *  It is the product's own data model -- sequence, steps, send -- rather than
 *  a generic messaging glyph.
 *
 *  Geometry is tuned for the sizes it actually renders at. The first draft put
 *  the curve 7.5 units from the middle node, which closed to a 0.25px gap at
 *  16px and merged into a blob in the browser tab; the arms now clear each
 *  node by 9 units, holding a ~0.75px gap at favicon size.
 *
 *  Colour comes from currentColor so one asset serves every context: white
 *  inside the sidebar tile, accent on a plain background, correct in both
 *  themes with no second file to keep in sync. */
export function Logo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Bottom node sweeps up through the middle to the top-right send. */}
      <path d="M10 39h13a9 9 0 000-18h-4a9 9 0 010-18h12" />
      <circle cx="10" cy="39" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="23" cy="30" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="4.5" fill="currentColor" stroke="none" />
      {/* Filled plane: holds its shape once strokes get thin. */}
      <path
        d="M43 3L34.5 25.5l-4-9.5-9.5-4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
