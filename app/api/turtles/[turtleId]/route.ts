import { NextRequest, NextResponse } from "next/server";
import { TURTLES } from "@/app/ui/constants";
import {
  cellText,
  getMembersSheet,
  memberIdColumn,
  membersColumn,
} from "@/app/lib/sheets/member-repository";
import { resolvePfpUrl } from "@/app/lib/pfp";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ turtleId: string }> }
) {
  try {
    const { turtleId } = await params;

    if (!turtleId) {
      return NextResponse.json(
        { error: "Missing turtle ID" },
        { status: 400 }
      );
    }

    // Validate that this is a known turtle
    const turtleDef = TURTLES.find(
      (t) => t.id.toLowerCase() === decodeURIComponent(turtleId).toLowerCase()
    );
    if (!turtleDef) {
      return NextResponse.json(
        { error: "Unknown turtle role" },
        { status: 404 }
      );
    }

    // Public read: served from the members data cache (tag "members").
    const sheet = await getMembersSheet();

    // Find column indices
    const idColIdx = memberIdColumn(sheet);
    const nameColIdx = membersColumn(sheet, ["name"]);
    const turtlesColIdx = membersColumn(sheet, ["turtles", "turtle"]);
    const cityColIdx = membersColumn(sheet, ["city"]);
    const statusColIdx = membersColumn(sheet, ["status", "frequency"]);

    if (nameColIdx == null || turtlesColIdx == null) {
      throw new Error("Could not find required columns");
    }

    // Filter members who have this turtle role
    const members: Array<{
      id: string;
      name: string;
      city: string;
      status: string;
      turtles: string;
      pfpUrl: string | null;
    }> = [];

    const targetTurtle = turtleDef.id.toLowerCase();

    for (const row of sheet.rows) {
      const cells = row?.c || [];

      const name = cellText(cells[nameColIdx]);
      if (!name) continue;

      const turtlesRaw = cellText(cells[turtlesColIdx]);
      if (!turtlesRaw) continue;

      // Split turtles and check if this member has the target turtle
      const memberTurtles = turtlesRaw
        .split(/[,/|]+/)
        .map((t: string) => t.trim())
        .filter(Boolean);

      const hasTurtle = memberTurtles.some(
        (t: string) => t.toLowerCase() === targetTurtle
      );

      if (!hasTurtle) continue;

      const id = cellText(cells[idColIdx]);
      const city = cityColIdx != null ? cellText(cells[cityColIdx]) : "";
      const status = statusColIdx != null ? cellText(cells[statusColIdx]) : "";

      members.push({
        id,
        name,
        city,
        status,
        turtles: turtlesRaw,
        // Resolved here so the page needs no per-member /api/pfp request.
        pfpUrl: id ? resolvePfpUrl(id) : null,
      });
    }

    const result = {
      turtle: {
        id: turtleDef.id,
        label: turtleDef.label,
        role: turtleDef.role,
        image: turtleDef.image,
      },
      members,
      count: members.length,
    };

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Failed to load turtle members:", error);
    return NextResponse.json(
      { error: "Failed to load turtle members" },
      { status: 500 }
    );
  }
}
