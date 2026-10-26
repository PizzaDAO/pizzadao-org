import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/app/lib/session";
import { disavowEnabled } from "@/app/lib/disavow/constants";
import { disavowViewer, findSubjectDisavowals } from "@/app/lib/disavow/access";

/**
 * /disavow must answer a real 404 (status and generic page) to everyone who may
 * not use it. The root layout wraps `children` in a Suspense boundary, so by the
 * time a page or nested layout calls notFound() the 200 status is already sent;
 * the decision therefore has to be made before rendering starts, here. Flag off,
 * logged out, or ineligible all rewrite to a path that does not exist, which
 * renders the site's own not-found page with a 404. The layout and pages keep
 * their own checks as defense in depth.
 */
export async function proxy(req: NextRequest) {
    if (await allowed(req)) return NextResponse.next();
    return NextResponse.rewrite(new URL("/_not-found-page", req.url));
}

async function allowed(req: NextRequest): Promise<boolean> {
    if (!disavowEnabled()) return false;
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

export const config = { matcher: ["/disavow", "/disavow/:path*"] };
