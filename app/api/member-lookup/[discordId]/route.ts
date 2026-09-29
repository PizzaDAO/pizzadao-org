// app/api/member-lookup/[discordId]/route.ts
//
// Public callers get only { found, memberId, memberName }.
// The full sheet row (`data`) and the unlinked-row name-search fallback
// (?searchName=) are only available to the owner — the signed-in user whose
// session Discord ID matches the requested one.
import { getSheetData } from "@/app/lib/sheets/member-repository";
import { getSession } from "@/app/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ discordId: string }> }
) {
    try {
        const { discordId } = await params;
        if (!discordId) return NextResponse.json({ error: "Missing Discord ID" }, { status: 400 });

        const session = await getSession();
        const isOwner = !!session?.discordId && session.discordId === discordId;

        const searchParams = new URL(request.url).searchParams;
        // Name-search fallback enumerates unlinked rows, so only the owner may use it.
        const searchName = isOwner ? (searchParams.get("searchName") || "").trim().toLowerCase() : "";

        const cache = await getSheetData();

        // 1. Search by Discord ID
        let memberId = cache.discordToMember.get(discordId);
        let foundMethod = "discord_id";
        let memberData = memberId != null ? cache.rows[cache.memberToIdx.get(memberId)!] : undefined;

        // 2. Fallback: Search by Name (owner only, if Discord ID not found)
        if (!memberData && searchName) {
            for (let idx = 0; idx < cache.rows.length; idx++) {
                const row = cache.rows[idx];
                const rowDiscord = String(row.discordId ?? "").trim();
                if (rowDiscord && rowDiscord !== "null" && rowDiscord !== "undefined") continue;

                const name = String(row["Name"] || row["Mafia Name"] || row["Real Name"] || "").trim().toLowerCase();
                if (name === searchName) {
                    memberData = row;
                    for (const [mid, i] of cache.memberToIdx) {
                        if (i === idx) { memberId = mid; break; }
                    }
                    foundMethod = "name_match";
                    break;
                }
            }
        }

        if (!memberData || !memberId) {
            return NextResponse.json({ found: false, error: "Member not found" }, { status: 404 });
        }

        const memberName = String(memberData["Name"] || memberData["Mafia Name"] || "");

        if (!isOwner) {
            return NextResponse.json(
                { found: true, memberId, memberName },
                { headers: { "Cache-Control": "private, no-store" } },
            );
        }

        // Owner: full row with standardized aliases
        const data: Record<string, unknown> = { ...memberData };
        data["Status"] = data["Status"] || data["Frequency"];
        data["Orgs"] = data["Orgs"] || data["Affiliation"];
        data["Skills"] = data["Skills"] || data["Specialties"];
        data["DiscordID"] = data["DiscordID"] || data["Discord"];

        return NextResponse.json(
            { found: true, memberId, memberName, data, method: foundMethod },
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (err: unknown) {
        console.error("[member-lookup] failed:", err);
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
}
