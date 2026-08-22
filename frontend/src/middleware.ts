import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** The web half of the gate.
 *
 *  Presence of the cookie is not enough -- a stale or forged value would pass
 *  a presence check and then every page would half-render into API 401s. The
 *  middleware asks the API to validate the session, so a bad cookie bounces
 *  to /login before any page code runs. One extra round-trip per navigation,
 *  on the compose network, for a single-user tool: cheap.
 *
 *  The API remains the actual authority. If this middleware were deleted the
 *  pages would stop rendering data but the data itself would still be closed.
 */

const SESSION_COOKIE = "outreach_session";
const API_BASE = process.env.API_URL ?? "http://api:8000";

async function sessionIsValid(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    // API unreachable: let the request through to render the ApiError page
    // rather than trapping the user on a login form that cannot work either.
    return true;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const valid = await sessionIsValid(request);

  if (pathname === "/login") {
    // Already signed in: the login page is the one place you shouldn't be.
    if (valid && request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!valid) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    const response = NextResponse.redirect(login);
    // A cookie that failed validation is dead weight; clearing it keeps the
    // login page's own redirect check from ever seeing it.
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  /* Static assets stay open -- the login page itself needs the CSS and the
     favicon, and none of it is data.
   *
   * The install surface has to be open too, and it is easy to get wrong: a
   * gated /sw.js answers the browser's fetch with a 307 to /login, which
   * fails service-worker registration silently -- no error, the app simply
   * never installs. Same for the manifest and the icons, which the OS
   * requests with no cookie attached at install time.
   *
   * Nothing here is data: an app name, a colour, six PNGs of the logo, and a
   * worker that is forbidden from touching /api. Every real route stays gated.
   */
  matcher: [
    /* Matched by shape, not by a list of filenames. The list version was
       already wrong once: adding splash-icon.png to public/ left it gated,
       so the icon 307'd to /login and the Android build could not fetch it.
       Anything a browser or an OS asks for before a session exists is a
       top-level static asset, and none of them are data.

       Only top-level is exempt -- the pattern has no slash before the
       extension -- so /prospects/secret.png would still be gated. */
    "/((?!_next/static|_next/image|health$|\.well-known/|[^/]+\.(?:png|svg|ico|webmanifest|js|txt|xml|webp|woff2?|html)$).*)",
  ],
};
