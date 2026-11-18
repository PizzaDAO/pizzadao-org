// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { clearSessionCookies } from "@/app/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const res = NextResponse.json({ ok: true });
    // Immediately expires the session cookie and writes the logged-out hint.
    return clearSessionCookies(res, req);
}
