"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* Connectivity, for an app that cannot work without the server.
 *
 * navigator.onLine is not enough on its own -- MDN says so outright. It
 * reports whether a network interface is up, not whether anything is
 * reachable: hotel wifi, captive portals, a VPN half-connected, or the
 * server simply being down all report `true` while every request fails.
 * Trusting it would leave the buttons live in exactly the cases the user
 * most needs them disabled.
 *
 * So `onLine === false` is treated as authoritative for OFFLINE (the OS
 * knows when the radio is off), while `true` is only a hint that we then
 * confirm with a real request to /health -- an endpoint deliberately
 * outside the auth gate, so probing it can never trip a redirect to /login.
 *
 * The probe only runs when it can change something: on mount, on the
 * browser's own events, when the tab is refocused, and on a slow poll while
 * offline so recovery is noticed without the user doing anything.
 */

type Connectivity = {
  online: boolean;
  /** True between losing the connection and the first successful recheck. */
  checking: boolean;
  /** Force an immediate probe -- used by the banner's "Retry" button. */
  recheck: () => void;
};

const ConnectivityContext = createContext<Connectivity>({
  online: true,
  checking: false,
  recheck: () => {},
});

export const useConnectivity = () => useContext(ConnectivityContext);

/** Same-origin so it follows the deploy; nginx proxies it to the API. */
const PROBE_URL = "/health";
const PROBE_TIMEOUT_MS = 5000;
const POLL_WHILE_OFFLINE_MS = 8000;

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  /* Starts optimistic. Rendering the banner during SSR and the first paint
     would flash "you're offline" on every cold load, which is worse than
     being briefly wrong in the rare offline case -- the first probe corrects
     it within a few hundred ms. */
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  // Guards against overlapping probes when several triggers fire at once.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const probe = useCallback(async () => {
    if (inFlight.current) return;

    // The radio being off is conclusive; skip the request entirely.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOnline(false);
      setChecking(false);
      return;
    }

    inFlight.current = true;
    setChecking(true);

    // AbortSignal.timeout is not in every engine we might meet; the manual
    // controller is equivalent and universally supported.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const res = await fetch(`${PROBE_URL}?_=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        /* same-origin, not omit. `omit` makes the browser refuse to follow a
           same-origin redirect and throws "Failed to fetch", so if /health
           were ever gated the probe would report a total outage while the
           network was perfectly fine. Sending the cookie to our own origin
           costs nothing and removes that failure mode. */
        credentials: "same-origin",
        redirect: "follow",
      });
      /* Any answer at all proves the server is reachable, which is the only
         question being asked. Insisting on 200 would turn a redirect or a
         degraded-but-responding backend into "you are offline" and disable
         the whole UI -- a worse outcome than letting a real request fail
         with a real error message. */
      if (mounted.current) setOnline(true);
      void res;
    } catch {
      // Abort, DNS failure, refused connection, captive-portal hijack that
      // fails CORS -- all mean the same thing to this app: unusable.
      if (mounted.current) setOnline(false);
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void probe();

    const goOffline = () => setOnline(false);
    const goOnline = () => void probe();
    const onVisible = () => {
      // Coming back to a backgrounded tab is the most likely moment for the
      // cached state to be stale.
      if (document.visibilityState === "visible") void probe();
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [probe]);

  /* Poll only while down. Polling while healthy would be pure noise: the
     events above already cover going offline, and a probe every 8s forever
     is a request per user per 8s for no information. */
  useEffect(() => {
    if (online) return;
    const id = setInterval(() => void probe(), POLL_WHILE_OFFLINE_MS);
    return () => clearInterval(id);
  }, [online, probe]);

  return (
    <ConnectivityContext.Provider value={{ online, checking, recheck: probe }}>
      {children}
    </ConnectivityContext.Provider>
  );
}
