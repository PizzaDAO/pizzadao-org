import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import {
  getSocialAccounts,
  linkSocialAccount,
  unlinkSocialAccount,
  SocialPlatform,
} from "@/app/lib/social-accounts";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

const VALID_PLATFORMS: SocialPlatform[] = ["TWITTER", "FARCASTER"];

/**
 * GET /api/social-accounts?memberId=X
 * Public - returns social accounts for a member
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const accounts = await getSocialAccounts(memberId);
    return NextResponse.json({ accounts }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' }
    });
  } catch (err: unknown) {
    console.error("Failed to fetch social accounts:", err);
    return NextResponse.json(
      { error: "Failed to fetch social accounts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/social-accounts
 * Authenticated - save/update a social account
 * Body: { memberId, platform: "TWITTER" | "FARCASTER", handle }
 * Or to unlink: { memberId, platform, unlink: true }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { memberId, platform, handle, unlink } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: "Invalid platform. Must be TWITTER or FARCASTER" },
        { status: 400 }
      );
    }

    // Verify ownership: the logged-in user must own this memberId
    const member = await fetchMemberById(memberId);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (member.discordId !== session.discordId) {
      return NextResponse.json(
        { error: "Forbidden: cannot edit another member" },
        { status: 403 }
      );
    }

    // Handle unlink
    if (unlink) {
      await unlinkSocialAccount(memberId, platform);
      return NextResponse.json({ ok: true, unlinked: platform });
    }

    // Validate handle
    if (!handle || typeof handle !== "string" || handle.trim().length === 0) {
      return NextResponse.json({ error: "Missing handle" }, { status: 400 });
    }

    const cleanHandle = handle.trim().replace(/^@/, "");
    if (cleanHandle.length > 100) {
      return NextResponse.json(
        { error: "Handle too long (max 100 chars)" },
        { status: 400 }
      );
    }

    await linkSocialAccount(memberId, platform, cleanHandle);

    // Resolve Farcaster FID via Neynar and store it
    if (platform === "FARCASTER") {
      try {
        const { lookupFarcasterUser } = await import("@/app/lib/farcaster");
        const fcUser = await lookupFarcasterUser(cleanHandle);
        if (fcUser) {
          await prisma.socialAccount.update({
            where: { memberId_platform: { memberId, platform: "FARCASTER" } },
            data: { platformId: String(fcUser.fid) },
          });
        }
      } catch (err) {
        // Non-fatal - FID will be resolved later on discovery
        console.warn("Could not resolve Farcaster FID:", err);
      }
    }

    return NextResponse.json({ ok: true, platform, handle: cleanHandle });
  } catch (err: unknown) {
    console.error("Failed to save social account:", err);
    return NextResponse.json(
      { error: "Failed to save social account" },
      { status: 500 }
    );
  }
}
