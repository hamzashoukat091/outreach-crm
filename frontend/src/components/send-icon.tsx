/** Paper-plane mark carried by every action that puts mail in front of a real
 *  person.
 *
 *  The teal send tier and the indigo accent are close in luminance and
 *  converge further under deuteranopia (separation ~2.1:1), so colour alone
 *  cannot be what tells them apart. The glyph is the actual signal; the hue
 *  reinforces it. */
export function SendIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 1.5L7.2 8.8M14.5 1.5l-4.6 13-2.7-5.7L1.5 6.1z" />
    </svg>
  );
}
