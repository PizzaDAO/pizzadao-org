// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { COOKIE_NAME, getSessionCookieOptions } from "@/app/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "", {
        ...getSessionCookieOptions(req),
        maxAge: 0, // Immediately expire the cookie
    });
    return res;
}
