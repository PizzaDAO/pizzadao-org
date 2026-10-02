// app/api/user-data/[id]/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
    findMemberRow,
    getMembersTable,
    memberIdColumn,
    rowToRecord,
} from "@/app/lib/sheets/member-repository";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

        // Require authentication
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        // Uncached on purpose: this feeds the member's edit form (a read-then-write
        // flow) and must reflect their own latest save; it also gates on ownership.
        const sheet = await getMembersTable({ fresh: true }).catch(() => {
            throw new Error("Failed to fetch sheet");
        });

        if (sheet.headerRowIndex === -1) {
            throw new Error(`Could not find header row (Name + Status/City). Checked 100 rows.`);
        }

        const idColIdx = memberIdColumn(sheet);
        const userRow = findMemberRow(sheet, id);

        if (!userRow) {
            const sampleIds = sheet.rows.slice(0, 10).map((r: any) => r?.c?.[idColIdx]?.v ?? r?.c?.[idColIdx]?.f).filter(Boolean);
            return NextResponse.json({
                error: `User ID ${id} not found. Sheet IDs: ${sampleIds.join(", ")}. Column index ${idColIdx} ('${sheet.headers[idColIdx]}')`,
                status: 404
            }, { status: 404 });
        }

        // Map data using human-readable keys from the header row
        const data: any = rowToRecord(sheet, userRow);

        // Add standardized aliases for UI convenience
        data["Status"] = data["Status"] || data["Frequency"];
        data["Orgs"] = data["Orgs"] || data["Affiliation"];
        data["Skills"] = data["Skills"] || data["Specialties"];
        data["DiscordID"] = data["DiscordID"] || data["Discord"] || data["DiscordId"] || data["discordid"];

        // Verify ownership: user can only view their own data
        const memberDiscordId = String(data["DiscordID"] || "").trim();
        if (memberDiscordId && memberDiscordId !== session.discordId) {
            return NextResponse.json({ error: "Forbidden: You can only view your own data" }, { status: 403 });
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return internalError(err, "user-data", "Failed to load member data");
    }
}
