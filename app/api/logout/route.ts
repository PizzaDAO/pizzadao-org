// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/app/lib/session";

export const runtime = "nodejs";

export async function POST() {
    const res = NextResponse.json({ ok: true });

    // Clear the session cookie by setting maxAge to 0
    res.cookies.set(COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    return res;
}

// Also support GET for simple redirects
export async function GET() {
    const res = NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"));

    res.cookies.set(COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    return res;
}
