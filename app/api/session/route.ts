import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
  fetchMemberByDiscordId,
  fetchMemberById,
} from "@/app/lib/sheets/member-repository";
import { getUserRoles } from "@/app/lib/discord";
import { canReviewAnyMission } from "@/app/lib/mission-review-access";
import { canManageShopRoles } from "@/app/lib/shop-admin-auth";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { disavowEnabled } from "@/app/lib/disavow/constants";
import { disavowViewerCached } from "@/app/lib/disavow/access";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";

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

  // Admin + mission-reviewer status from one guild-roles lookup (fails closed).
  // canReviewMissions (not isAdmin) gates the /missions review panel: the
  // reviewer roles are wider than the admin roles (mission-review-access.ts).
  // canManageShop: the /add-money rule (admin roles + Pepperoni Mafia), for
  // the /admin/shop link; the page and its API check it again server-side.
  let canReviewMissions = false;
  let canManageShop = false;
  try {
    const roles = await getUserRoles(session.discordId);
    isAdmin = roles.some((r) => (ADMIN_ROLE_IDS as readonly string[]).includes(r));
    [canReviewMissions, canManageShop] = await Promise.all([
      canReviewAnyMission(roles),
      canManageShopRoles(roles),
    ]);
  } catch {
    isAdmin = false;
    canReviewMissions = false;
    canManageShop = false;
  }

  // Disavow list: only computed while the feature flag is on; fails closed.
  // Never present (not even false) when the flag is off, so nothing hints at it.
  let disavowFlags: { canViewDisavow: true; canVoteDisavow: boolean; disavowNavLabel: string } | null = null;
  if (disavowEnabled()) {
    // Cached 60s per user: this endpoint is polled. Data guards never use the cache.
    const v = await disavowViewerCached(session.discordId);
    if (v.allowed) {
      // Present only for eligible viewers (never a `false`), with the label
      // localized server-side: the disavow strings are not in the root catalog.
      let label = "Disavow list";
      try {
        label = (await getDisavowTranslator())("navLabel");
      } catch { /* keep the English fallback */ }
      disavowFlags = { canViewDisavow: true, canVoteDisavow: v.isDPR, disavowNavLabel: label };
    }
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
      canReviewMissions,
      canManageShop,
      ...(disavowFlags ?? {}),
    },
    {
      headers: { "Cache-Control": "private, max-age=300" },
    },
  );
}
