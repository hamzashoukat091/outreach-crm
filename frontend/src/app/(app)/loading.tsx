import { Logo } from "@/components/logo";

/** Shown while a route's data resolves.
 *
 *  Without this, navigation held the previous screen and then swapped -- on a
 *  slow query it read as a click that did nothing. The mark doing the waiting
 *  is the cheapest possible brand moment: it appears on every page transition
 *  and costs nothing to maintain. */
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-8 w-8 animate-pulse text-accent motion-reduce:animate-none" />
        <p className="text-sm text-muted">Loading…</p>
      </div>
    </div>
  );
}
