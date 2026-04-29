import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { findMemberIdByDiscordId } from "@/app/lib/member-utils";
import { prisma } from "@/app/lib/db";
import {
  lookupFarcasterUser,
  getFarcasterFollowing,
  FarcasterUser,
} from "@/app/lib/farcaster";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const memberId = await findMemberIdByDiscordId(session.discordId);
  if (!memberId) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Get user's Farcaster account
  const account = await prisma.socialAccount.findUnique({
    where: { memberId_platform: { memberId, platform: "FARCASTER" } },
  });

  if (!account) {
    return NextResponse.json(
      { error: "No Farcaster account linked" },
      { status: 400 }
    );
  }

  // Resolve FID if not stored yet
  let fid = account.platformId ? parseInt(account.platformId, 10) : null;
  if (!fid) {
    const fcUser = await lookupFarcasterUser(account.handle);
    if (!fcUser) {
      return NextResponse.json(
        { error: "Could not resolve Farcaster handle" },
        { status: 404 }
      );
    }
    fid = fcUser.fid;
    // Store FID for future use
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { platformId: String(fid) },
    });
  }

  // Fetch following list
  const following = await getFarcasterFollowing(fid);

  // Get all Farcaster accounts in our DB to cross-reference
  const allFcAccounts = await prisma.socialAccount.findMany({
    where: { platform: "FARCASTER" },
    select: { memberId: true, handle: true, platformId: true },
  });

  // Build username->memberId map (case-insensitive)
  const handleToMember = new Map<string, string>();
  for (const a of allFcAccounts) {
    handleToMember.set(a.handle.toLowerCase(), a.memberId);
  }

  // Cross-reference following list with PizzaDAO members
  const onPizzaDAO: Array<{
    fid: number;
    fcUsername: string;
    fcDisplayName: string;
    fcPfp: string;
    memberId: string;
    memberName: string;
    memberCity: string;
    memberCrews: string;
  }> = [];
  const notOnPizzaDAO: FarcasterUser[] = [];

  for (const f of following) {
    const matchedMemberId = handleToMember.get(f.username.toLowerCase());
    if (matchedMemberId && matchedMemberId !== memberId) {
      // On PizzaDAO - fetch member data
      const member = await fetchMemberById(matchedMemberId);
      onPizzaDAO.push({
        fid: f.fid,
        fcUsername: f.username,
        fcDisplayName: f.displayName,
        fcPfp: f.pfpUrl,
        memberId: matchedMemberId,
        memberName: member?.name ? String(member.name) : f.displayName,
        memberCity: member?.city ? String(member.city) : "",
        memberCrews: member?.crews ? String(member.crews) : "",
      });
    } else if (!matchedMemberId) {
      notOnPizzaDAO.push(f);
    }
  }

  return NextResponse.json({ onPizzaDAO, notOnPizzaDAO });
}
