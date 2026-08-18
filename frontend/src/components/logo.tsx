/** The Outreach mark.
 *
 *  Three nodes threaded by an S-path, with a paper plane leaving the top node
 *  -- sequence, steps, send.
 *
 *  Traced from the source artwork rather than redrawn by eye: node centres,
 *  radii (7.7 ring / 2.7 core) and the 3.3-unit stroke are measured off the
 *  original on a 64 grid. An earlier pass here reinvented the geometry to win
 *  a sub-pixel gap at favicon size and lost the shape doing it; small-size
 *  legibility belongs to the simplified icon.svg, not to this file.
 *
 *  Draws in currentColor so one asset serves the sidebar tile (white) and
 *  plain backgrounds (accent) in both themes. `coreClassName` tints the node
 *  centres, which are lighter than the ring in the source. */
export function Logo({
  className = "h-5 w-5",
  coreClassName = "text-white/55",
}: {
  className?: string;
  coreClassName?: string;
}) {
  return (
    <svg
      viewBox="10.5 7.5 47.5 49.5"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Bottom-left node runs right, doubles back left through the middle
          node, then right again to the top node. The two returns are what
          make the S. */}
      <path d="M17.7 49.6H36.9a6 6 0 000-12H24a7.1 7.1 0 010-14.2h4.2" />

      {/* Nodes: solid ring with a lighter core. */}
      <circle cx="17.7" cy="49.6" r="5.15" fill="currentColor" stroke="none" />
      <circle cx="17.7" cy="49.6" r="2.7" className={coreClassName} fill="currentColor" stroke="none" />

      <circle cx="35.1" cy="37.6" r="5.15" fill="currentColor" stroke="none" />
      <circle cx="35.1" cy="37.6" r="2.7" className={coreClassName} fill="currentColor" stroke="none" />

      <circle cx="28.2" cy="23.4" r="5.15" fill="currentColor" stroke="none" />
      <circle cx="28.2" cy="23.4" r="2.7" className={coreClassName} fill="currentColor" stroke="none" />

      {/* The send: a large plane, clear of the path, with the folded wing
          notched so it reads as a plane and not a triangle. */}
      <path
        d="M55.5 9.5L37.5 17.2l7.2 3.1 3.1 7.2z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M55.5 9.5L44.7 20.3" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
