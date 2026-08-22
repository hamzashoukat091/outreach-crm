/* Service worker for the installed app.
 *
 * Deliberately conservative about what it caches. This is an authenticated
 * CRM whose data changes under you: cache an API response and you show a
 * prospect that was archived an hour ago; cache an HTML page and a signed-out
 * phone can still render a screen full of real names. So:
 *
 *   - navigations  -> network only, with an offline fallback page
 *   - /api/*       -> never touched, always straight to the network
 *   - static build assets (/_next/static/*, icons) -> cache first
 *
 * /_next/static is content-hashed, so cache-first is safe there by
 * construction: a changed file gets a new URL and simply misses the cache.
 */

const VERSION = "v1";
const SHELL = `outreach-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, so one 404 doesn't reject the whole install and leave
      // the app with no worker at all.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth and data: the worker must never answer these.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: always live. Falling back to a cached shell here would show
  // a logged-in layout to a signed-out user.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ??
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
        );
      }),
    );
    return;
  }

  // Hashed build output and icons: cache first, then fill.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|svg|ico|woff2?)$/.test(url.pathname);

  if (!isStatic) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          // Opaque/error responses are not worth persisting.
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

/* Web Push. Not wired to a backend yet -- when it is, the payload shape below
   is what the server should send. Handling it now means an installed app
   picks up notifications on the next deploy without reinstalling. */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Outreach", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Outreach", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag ?? "outreach",
      data: { url: payload.url ?? "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing window rather than stacking up new ones.
      for (const client of clients) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      const existing = clients[0];
      if (existing) {
        existing.focus();
        return existing.navigate(target);
      }
      return self.clients.openWindow(target);
    }),
  );
});
