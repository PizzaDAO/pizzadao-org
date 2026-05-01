import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
  fetchMemberByDiscordId,
  fetchMemberById,
} from "@/app/lib/sheets/member-repository";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();

  if (!session?.discordId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Resolve member data from shared cache (Phase 2)
  let memberId: string | null = null;
  let memberName: string | null = null;
  let crews: string[] = [];
  let isAdmin = false;

  try {
    const member = await fetchMemberByDiscordId(session.discordId);
    if (member) {
      memberId = member.memberId;
      memberName = member.name;

      // Get full member data for crews
      const fullData = await fetchMemberById(memberId);
      if (fullData) {
        const crewsStr = String(fullData["Crews"] || "").trim();
        crews =
          crewsStr && crewsStr !== "None"
            ? crewsStr
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean)
            : [];
      }
    }
  } catch {
    // Silently fail - memberId will be null
  }

  // Check admin status (parallel-safe since it's a Discord API call)
  try {
    isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS);
  } catch {
    isAdmin = false;
  }

  // PFP is a quick fs check - include it to avoid a separate request
  let pfpPath: string | null = null;
  if (memberId) {
    const fs = await import("fs");
    const path = await import("path");
    const pfpDir = path.join(process.cwd(), "public", "pfp");

    if (fs.existsSync(path.join(pfpDir, `${memberId}.jpg`))) {
      pfpPath = `/pfp/${memberId}.jpg`;
    } else if (fs.existsSync(path.join(pfpDir, `${memberId}.png`))) {
      pfpPath = `/pfp/${memberId}.png`;
    }
  }

  return NextResponse.json(
    {
      authenticated: true,
      discordId: session.discordId,
      username: session.username,
      nick: session.nick,
      memberId,
      memberName,
      pfpUrl: pfpPath,
      crews,
      isAdmin,
    },
    {
      headers: { "Cache-Control": "private, max-age=300" },
    },
  );
}
