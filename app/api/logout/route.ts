// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/app/lib/session";

export const runtime = "nodejs";

export async function POST() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0, // Immediately expire the cookie
    });
    return res;
}
