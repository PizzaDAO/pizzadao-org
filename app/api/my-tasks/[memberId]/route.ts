import { NextResponse } from "next/server";

const CREW_MAPPINGS_URL = "/api/crew-mappings"; // We'll fetch from our own API

// Simplified types for the tasks API
type Task = { label: string; url?: string };
type CrewTasks = { crewId: string; tasks: Task[] };

export const runtime = "nodejs";

// Helper to extract sheet ID (copied from crew-mappings/route.ts)
function extractSheetId(url: string) {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// Helper to construct GViz URL (copied from crew-mappings/route.ts)
function gvizUrl(sheetId: string, tabName?: string) {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set("tqx", "out:json");
    if (tabName) url.searchParams.set("sheet", tabName);
    url.searchParams.set("headers", "1");
    return url.toString();
}

// Google GViz wraps JSON inside a JS function call (copied from crew-mappings/route.ts)
function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const json = cleaned.slice(start, end + 1);
    return JSON.parse(json);
}

async function fetchMyTasksForCrew(sheetUrl: string, memberId: string): Promise<Task[]> {
    const id = extractSheetId(sheetUrl);
    if (!id) return [];

    try {
        const url = gvizUrl(id); // default tab
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } });
        if (!res.ok) return [];

        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        const myTasks: Task[] = [];
        const normalizedMemberId = String(memberId).trim().toLowerCase();

        for (let ri = 0; ri < rows.length; ri++) {
            const rowCells = rows[ri]?.c || [];
            let foundTasksTitle = false;
            let titleCol = -1;

            for (let ci = 0; ci < rowCells.length; ci++) {
                const val = String(rowCells[ci]?.v || "").trim().toLowerCase();
                if (val === "tasks") {
                    foundTasksTitle = true;
                    titleCol = ci;
                    break;
                }
            }

            if (foundTasksTitle) {
                // Look for headers below this specific "Tasks" title
                let hRowIdx = -1;
                let tIdx = -1;
                let lIdx = -1;

                for (let i = 0; i <= 5; i++) {
                    const checkRi = ri + i;
                    if (checkRi >= rows.length) break;
                    const row = rows[checkRi]?.c || [];

                    const taskHeaderIdx = row.findIndex((c: any, ci: number) => {
                        const v = String(c?.v || "").toLowerCase().trim();
                        if (!v.includes("task")) return false;
                        if (checkRi === ri && ci === titleCol) return false;
                        return true;
                    });

                    // IMPORTANT: Prioritize "Lead ID" over just "Lead"
                    let leadHeaderIdx = row.findIndex((c: any) => {
                        const v = String(c?.v || "").toLowerCase().trim();
                        return v.includes("lead id") || v.startsWith("# lead");
                    });
                    if (leadHeaderIdx === -1) {
                        leadHeaderIdx = row.findIndex((c: any) => {
                            const v = String(c?.v || "").toLowerCase().trim();
                            return v === "lead";
                        });
                    }

                    if (taskHeaderIdx !== -1 && leadHeaderIdx !== -1) {
                        hRowIdx = checkRi;
                        tIdx = taskHeaderIdx;
                        lIdx = leadHeaderIdx;
                        break;
                    }
                }

                if (hRowIdx !== -1) {
                    // Extract tasks from this table until we hit the next table or end
                    // (Actually, we can just scan all rows below it, but to be safer 
                    // and follow existing patterns, we'll scan until we see another potential title or empty row cluster)
                    for (let j = hRowIdx + 1; j < rows.length; j++) {
                        const r = rows[j]?.c || [];
                        if (!r || r.length === 0) continue;

                        // If we see another "Tasks" in the first few columns, this table is done
                        const firstFew = r.slice(0, 3).map((c: any) => String(c?.v || "").trim().toLowerCase());
                        if (firstFew.includes("tasks")) break;

                        const taskCell = r[tIdx];
                        const leadIdCell = r[lIdx];
                        const taskLabel = String(taskCell?.v || "").trim();

                        const v = String(leadIdCell?.v ?? "").trim().toLowerCase();
                        const f = String(leadIdCell?.f ?? "").trim().toLowerCase();

                        // Fallback: Check the column immediately to the right of the matched Lead column
                        // This helps when the Lead ID header itself is missing/null (like in Ops)
                        const nextCell = r[lIdx + 1];
                        const nextV = String(nextCell?.v ?? "").trim().toLowerCase();
                        const nextF = String(nextCell?.f ?? "").trim().toLowerCase();

                        const isMatch = (v === normalizedMemberId || f === normalizedMemberId ||
                            nextV === normalizedMemberId || nextF === normalizedMemberId);

                        if (taskLabel && isMatch) {
                            // Avoid duplicates if a task is in both tables for some reason
                            if (!myTasks.some(t => t.label === taskLabel)) {
                                myTasks.push({ label: taskLabel, url: taskCell?.l || undefined });
                            }
                        }
                    }
                }
            }
        }

        return myTasks;
    } catch (e) {
        console.error("fetchMyTasksForCrew error:", e);
        return [];
    }
}

export async function GET(req: Request, { params }: { params: Promise<{ memberId: string }> }) {
    const { memberId } = await params;
    if (!memberId) return NextResponse.json({ error: "No memberId" }, { status: 400 });

    try {
        // 1. Get crews list from our own mappings API
        // We need the absolute URL for fetch in Route Handlers if not using a relative tool
        const protocol = req.headers.get("x-forwarded-proto") || "http";
        const host = req.headers.get("host");
        const mappingsRes = await fetch(`${protocol}://${host}/api/crew-mappings`);
        if (!mappingsRes.ok) throw new Error("Failed to fetch crew mappings");
        const { crews } = await mappingsRes.json();

        const results: Record<string, Task[]> = {};

        // 2. Parallel fetch personalized tasks for each crew
        await Promise.all(
            crews.map(async (c: any) => {
                if (c.sheet) {
                    const tasks = await fetchMyTasksForCrew(c.sheet, memberId);
                    if (tasks.length > 0) {
                        results[c.id] = tasks;
                    }
                }
            })
        );

        return NextResponse.json({ tasksByCrew: results });
    } catch (err: any) {
        return NextResponse.json({ error: String(err.message) }, { status: 500 });
    }
}
