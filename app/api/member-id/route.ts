// app/api/member-id/route.ts
import { NextResponse } from "next/server";
import { getMembersTable, memberIdColumn } from "@/app/lib/sheets/member-repository";
import type { GvizRow } from "@/app/lib/types/gviz";

export const runtime = "nodejs";

function collectIds(rows: GvizRow[], idColIdx: number, into: Set<number>) {
    for (const row of rows) {
        const idVal = row?.c?.[idColIdx]?.v ?? row?.c?.[idColIdx]?.f;
        if (typeof idVal === "number") {
            into.add(idVal);
        } else if (typeof idVal === "string" && idVal.trim()) {
            const parsed = parseInt(idVal.trim(), 10);
            if (!isNaN(parsed)) into.add(parsed);
        }
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const checkId = searchParams.get("check");

        // Uncached on purpose: onboarding picks a new member ID from this answer
        // and then writes it, so a stale sheet could hand out an ID already taken.
        const sheet = await getMembersTable({ fresh: true }).catch(() => {
            throw new Error("Failed to fetch sheet");
        });

        const claimedIds = new Set<number>();

        if (sheet.headerRowIndex !== -1) {
            // Found the header row, data starts immediately after
            collectIds(sheet.rows, memberIdColumn(sheet), claimedIds);
        } else {
            // Extreme fallback: just use column A and try to find numbers
            collectIds(sheet.allRows, 0, claimedIds);
        }

        if (checkId) {
            const idToCheck = parseInt(checkId, 10);
            if (isNaN(idToCheck) || idToCheck <= 0) {
                return NextResponse.json({ available: false, error: "Invalid ID" });
            }
            return NextResponse.json({ available: !claimedIds.has(idToCheck) });
        }

        // Find next 4 lowest available IDs
        const suggestions: number[] = [];
        let current = 1;
        while (suggestions.length < 4 && current < 10000) {
            if (!claimedIds.has(current)) {
                suggestions.push(current);
            }
            current++;
        }

        return NextResponse.json({ suggestions });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
