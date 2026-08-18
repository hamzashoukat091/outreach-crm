/** Paper-plane mark carried by every action that puts mail in front of a real
 *  person.
 *
 *  Geometrically the same plane as the one leaving the logo, scaled from the
 *  brand mark's 48-unit grid to 16. Two differently-angled planes in one
 *  product reads as an accident, and this one appears directly beneath the
 *  logo in the sidebar's line of sight.
 *
 *  The teal send tier and the indigo accent are close in luminance and
 *  converge further under deuteranopia (separation ~2.1:1), so colour alone
 *  cannot be what tells them apart. The glyph is the actual signal. */
export function SendIcon() {
  return (
    <svg
      viewBox="19.5 1.5 25 25.5"
      aria-hidden
      className="h-3.5 w-3.5 shrink-0"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M43 3L34.5 25.5l-4-9.5-9.5-4z" />
    </svg>
  );
}
