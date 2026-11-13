import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/app/lib/session";
import { disavowEnabled } from "@/app/lib/disavow/constants";
import { disavowViewer, findSubjectDisavowals } from "@/app/lib/disavow/access";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { hostRedirectTarget, isExcludedFromHostRedirect, mappedPath, onLegacyHost } from "@/app/lib/site-redirect";
import {
    BRIDGE_COOKIE,
    BRIDGE_RESPONSE_HEADERS,
    bridgeCookieOptions,
    isPrefetchLike,
    mintBridge,
} from "@/app/lib/session-bridge";
import { SITE_URL } from "@/app/lib/site-url";

/**
 * Two jobs.
 *
 * 1. Old app host -> main site (plans/pizzadao-org-to-vercel.md, Phase 3): while the member app is
 *    served from the pizzadao.org apex, page requests on app.pizzadao.org redirect path for path
 *    (query kept; "/" goes to /start), never /api, /_next, /_vercel or /.well-known. Behind the
 *    site.hostRedirectEnabled switch (off by default), and only on a build whose SITE_URL is the
 *    new origin, so a build with the old env never redirects. 307 until site.hostRedirectPermanent.
 *    With site.sessionBridgeEnabled a signed-in member is handed over to the main site's session
 *    transfer endpoint instead of landing signed out (app/lib/session-bridge.ts).
 * 2. /disavow must answer a real 404 (status and generic page) to everyone who may
 *    not use it. The root layout wraps `children` in a Suspense boundary, so by the
 *    time a page or nested layout calls notFound() the 200 status is already sent;
 *    the decision therefore has to be made before rendering starts, here. Flag off,
 *    logged out, or ineligible all rewrite to a path that does not exist, which
 *    renders the site's own not-found page with a 404. The layout and pages keep
 *    their own checks as defense in depth.
 */
export async function proxy(req: NextRequest) {
    const moved = await hostRedirect(req);
    if (moved) return moved;
    const path = req.nextUrl.pathname;
    if (path !== "/disavow" && !path.startsWith("/disavow/")) return NextResponse.next();
    if (await allowed(req)) return NextResponse.next();
    return NextResponse.rewrite(new URL("/_not-found-page", req.url));
}

/** The redirect to the main site for an old-host page request, or null to carry on. Fails open (no redirect). */
async function hostRedirect(req: NextRequest): Promise<NextResponse | null> {
    // Cheap checks first: on every host but the old one (and on any build that still has the old SITE_URL) nothing else runs.
    if (!onLegacyHost(req.headers.get("host") ?? req.nextUrl.hostname)) return null;
    const { pathname, search } = req.nextUrl;
    if (isExcludedFromHostRedirect(pathname)) return null;
    try {
        const settings = await loadSettings();
        if (!resolveToggle("site.hostRedirectEnabled", settings)) return null;
        const target = hostRedirectTarget(pathname, search);
        if (!target) return null;

        if (
            req.method === "GET" &&
            !isPrefetchLike(req.headers) &&
            resolveToggle("site.sessionBridgeEnabled", settings)
        ) {
            const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
            const bridge = session ? mintBridge(session, mappedPath(pathname, search), SITE_URL) : null;
            if (bridge) {
                // Always a 307 with no-store: the URL carries a one-time token and must never be cached.
                const res = NextResponse.redirect(bridge.url, 307);
                res.cookies.set(BRIDGE_COOKIE, bridge.jti, bridgeCookieOptions(SITE_URL));
                for (const [k, v] of Object.entries(BRIDGE_RESPONSE_HEADERS)) res.headers.set(k, v);
                return res;
            }
        }

        // Saved rows only count on production (previews share the database): elsewhere it stays a 307.
        const permanent = process.env.VERCEL_ENV === "production" && settings.get("site.hostRedirectPermanent") === true;
        return NextResponse.redirect(target, permanent ? 308 : 307);
    } catch {
        return null;
    }
}

async function allowed(req: NextRequest): Promise<boolean> {
    if (!(await disavowEnabled())) return false;
    try {
        const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
        if (!session?.discordId) return false;
        if ((await disavowViewer(session.discordId)).allowed) return true;
        // A listed member may reach their own response page.
        return (await findSubjectDisavowals(session.discordId)).length > 0;
    } catch {
        return false; // fail closed
    }
}

// /disavow everywhere, plus (only on the old app host, for the redirect) every page path;
// /api, /_next, /_vercel, /.well-known and dotted static files never reach this function.
export const config = {
    matcher: [
        "/disavow",
        "/disavow/:path*",
        {
            source: "/((?!api(?:/|$)|_next/|_vercel/|\\.well-known/|.*\\..*).*)",
            has: [{ type: "host", value: "app.pizzadao.org" }],
        },
    ],
};
