// app/api/member-lookup/[discordId]/route.ts
import { getSheetData } from "@/app/lib/sheets/member-repository";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ discordId: string }> }
) {
    try {
        const { discordId } = await params;
        if (!discordId) return NextResponse.json({ error: "Missing Discord ID" }, { status: 400 });

        const searchParams = new URL(request.url).searchParams;
        const searchName = (searchParams.get("searchName") || "").trim().toLowerCase();

        const cache = await getSheetData();

        // 1. Search by Discord ID
        let memberId = cache.discordToMember.get(discordId);
        let foundMethod = "discord_id";
        let memberData = memberId != null ? cache.rows[cache.memberToIdx.get(memberId)!] : undefined;

        // 2. Fallback: Search by Name (if provided and Discord ID not found)
        if (!memberData && searchName) {
            for (let idx = 0; idx < cache.rows.length; idx++) {
                const row = cache.rows[idx];
                const rowDiscord = String(row.discordId ?? "").trim();
                if (rowDiscord && rowDiscord !== "null" && rowDiscord !== "undefined") continue;

                const name = String(row["Name"] || row["Mafia Name"] || row["Real Name"] || "").trim().toLowerCase();
                if (name === searchName) {
                    memberData = row;
                    // Find memberId from memberToIdx (reverse lookup)
                    for (const [mid, i] of cache.memberToIdx) {
                        if (i === idx) { memberId = mid; break; }
                    }
                    foundMethod = "name_match";
                    break;
                }
            }
        }

        if (!memberData || !memberId) {
            return NextResponse.json({
                error: `Member not found for Discord ID '${discordId}' (or name '${searchName}').`,
                status: 404
            }, { status: 404 });
        }

        // Build data with standardized aliases
        const data: Record<string, any> = { ...memberData };
        data["Status"] = data["Status"] || data["Frequency"];
        data["Orgs"] = data["Orgs"] || data["Affiliation"];
        data["Skills"] = data["Skills"] || data["Specialties"];
        data["DiscordID"] = data["DiscordID"] || data["Discord"];

        const memberName = data["Name"] || data["Mafia Name"] || "";

        return NextResponse.json({ found: true, memberId, memberName, data, method: foundMethod });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
