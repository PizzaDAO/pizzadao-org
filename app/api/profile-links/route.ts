// app/api/profile-links/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

const MAX_LINKS = 8;
const MAX_URL_LENGTH = 500;
const MAX_LABEL_LENGTH = 50;

// Simple emoji validation - allow any single emoji or short emoji sequence
function isValidEmoji(str: string): boolean {
  if (!str || str.length === 0 || str.length > 10) return false;
  // Must contain at least one emoji-range character and not contain typical alphanumeric text
  const hasEmoji = /\p{Emoji}/u.test(str);
  const isPlainText = /^[a-zA-Z0-9\s]+$/.test(str);
  return hasEmoji && !isPlainText;
}

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * GET /api/profile-links?memberId=123
 * Public - fetches links for a member profile
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const links = await prisma.profileLink.findMany({
      where: { memberId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        emoji: true,
        url: true,
        label: true,
        sortOrder: true,
      },
    });

    return NextResponse.json({ links });
  } catch (err: unknown) {
    console.error("Failed to fetch profile links:", err);
    return NextResponse.json({ error: "Failed to fetch links" }, { status: 500 });
  }
}

/**
 * POST /api/profile-links
 * Authenticated - saves all links for the current user's profile
 * Body: { memberId: string, links: { emoji: string, url: string, label?: string }[] }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { memberId, links } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    // Verify ownership: the logged-in user must own this memberId
    const member = await fetchMemberById(memberId);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (member.discordId !== session.discordId) {
      return NextResponse.json({ error: "Forbidden: cannot edit another member" }, { status: 403 });
    }

    // Validate links array
    if (!Array.isArray(links)) {
      return NextResponse.json({ error: "links must be an array" }, { status: 400 });
    }

    if (links.length > MAX_LINKS) {
      return NextResponse.json({ error: `Maximum ${MAX_LINKS} links allowed` }, { status: 400 });
    }

    // Validate each link
    const validatedLinks: { emoji: string; url: string; label: string | null; sortOrder: number }[] = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const emoji = String(link.emoji || "").trim();
      const url = String(link.url || "").trim();
      const label = link.label ? String(link.label).trim().slice(0, MAX_LABEL_LENGTH) : null;

      if (!emoji || !isValidEmoji(emoji)) {
        return NextResponse.json({ error: `Invalid emoji at position ${i + 1}` }, { status: 400 });
      }

      if (!url || url.length > MAX_URL_LENGTH || !isValidUrl(url)) {
        return NextResponse.json({ error: `Invalid URL at position ${i + 1}` }, { status: 400 });
      }

      validatedLinks.push({ emoji, url, label, sortOrder: i });
    }

    // Replace all links for this member in a transaction
    await prisma.$transaction([
      prisma.profileLink.deleteMany({ where: { memberId } }),
      ...validatedLinks.map((link) =>
        prisma.profileLink.create({
          data: {
            memberId,
            emoji: link.emoji,
            url: link.url,
            label: link.label,
            sortOrder: link.sortOrder,
          },
        })
      ),
    ]);

    // Fetch and return the saved links
    const saved = await prisma.profileLink.findMany({
      where: { memberId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        emoji: true,
        url: true,
        label: true,
        sortOrder: true,
      },
    });

    return NextResponse.json({ ok: true, links: saved });
  } catch (err: unknown) {
    console.error("Failed to save profile links:", err);
    return NextResponse.json({ error: "Failed to save links" }, { status: 500 });
  }
}
