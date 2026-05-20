// app/lib/my-tasks.ts
//
// Shared helper for fetching a member's active tasks + done count from a
// single crew Google Sheet. Extracted from
// `app/api/my-tasks/[memberId]/route.ts` so it can be reused by
// `/api/dashboard-summary` without an internal HTTP round-trip (Vercel
// deployment protection blocks self-fetches).
//
// The route handler in `app/api/my-tasks/[memberId]/route.ts` continues to
// use its own in-file copy for now — extracting that fully is out of scope
// for olive-83105; a follow-up can collapse the duplicate.

import { parseGvizJson } from "@/app/lib/gviz-parser";
import { getTaskLinks } from "@/app/api/lib/google-sheets";

export type MyTask = { label: string; url?: string };
export type CrewTaskData = { active: MyTask[]; doneCount: number };

function extractSheetId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

function gvizUrl(sheetId: string, tabName?: string): string {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set("tqx", "out:json");
    if (tabName) url.searchParams.set("sheet", tabName);
    url.searchParams.set("headers", "1");
    return url.toString();
}

function extractUrlFromText(text: string): string | undefined {
    const parenMatch = text.match(/\((https?:\/\/[^\s\)]+)\)/);
    if (parenMatch) return parenMatch[1];
    const rawMatch = text.match(/https?:\/\/[^\s\)]+/);
    if (rawMatch) return rawMatch[0];
    const domainMatch = text.match(/([a-z A-Z0-9-]+\.(?:com|pizza|xyz|org|net|io|me))/i);
    if (domainMatch) return `https://${domainMatch[1]}`;
    return undefined;
}

/**
 * Fetch the given member's active tasks and "closed" count from a single
 * crew sheet. Returns { active: [], doneCount: 0 } on any failure.
 */
export async function fetchMyTasksForCrew(
    sheetUrl: string,
    memberId: string
): Promise<CrewTaskData> {
    const id = extractSheetId(sheetUrl);
    if (!id) return { active: [], doneCount: 0 };

    try {
        const url = gvizUrl(id);
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
            next: { revalidate: 300 },
        });
        if (!res.ok) return { active: [], doneCount: 0 };

        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        const myTasks: MyTask[] = [];
        let doneCount = 0;
        const normalizedMemberId = String(memberId).trim().toLowerCase();

        let htmlLinkMap: Record<string, string> = {};
        try {
            htmlLinkMap = id ? await getTaskLinks(id) : {};
        } catch {
            // Non-fatal
        }

        // Phase 1: find "Closed" count under the Crew table
        let foundClosed = false;
        for (let ri = 0; ri < rows.length; ri++) {
            const rowCells = rows[ri]?.c || [];
            let crewTitleCol = -1;

            for (let ci = 0; ci < rowCells.length; ci++) {
                const v = String(rowCells[ci]?.v || "").trim().toLowerCase();
                const f = String(rowCells[ci]?.f || "").trim().toLowerCase();
                if (v.startsWith("crew") || f.startsWith("crew")) {
                    crewTitleCol = ci;
                    break;
                }
            }

            if (crewTitleCol !== -1) {
                let idCol = -1;
                let closedCol = -1;
                let hRowIdx = -1;

                for (let i = 0; i <= 5; i++) {
                    const checkRi = ri + i;
                    if (checkRi >= rows.length) break;
                    const row = rows[checkRi]?.c || [];
                    const rowVals = row.map((c: any) =>
                        String(c?.v || "").toLowerCase().trim()
                    );
                    const rowForms = row.map((c: any) =>
                        String(c?.f || "").toLowerCase().trim()
                    );

                    if (idCol === -1) {
                        const foundId =
                            rowVals.indexOf("id") !== -1
                                ? rowVals.indexOf("id")
                                : rowForms.indexOf("id");
                        if (foundId !== -1) {
                            idCol = foundId;
                            hRowIdx = checkRi;
                        }
                    }

                    if (closedCol === -1) {
                        const foundClosedCol =
                            rowVals.indexOf("closed") !== -1
                                ? rowVals.indexOf("closed")
                                : rowForms.indexOf("closed");
                        if (foundClosedCol !== -1) {
                            closedCol = foundClosedCol;
                        }
                    }

                    if (idCol !== -1 && closedCol !== -1) break;
                }

                // Ops Crew fallback
                if (idCol !== -1 && closedCol === -1) {
                    closedCol = 8;
                }

                if (idCol !== -1 && closedCol !== -1) {
                    for (let j = hRowIdx + 1; j < rows.length; j++) {
                        const r = rows[j]?.c || [];
                        if (!r || r.length === 0) continue;

                        const idCellValue = String(r[idCol]?.v ?? "").trim().toLowerCase();
                        const idCellFormatted = String(r[idCol]?.f ?? "").trim().toLowerCase();

                        if (
                            idCellValue === normalizedMemberId ||
                            idCellFormatted === normalizedMemberId
                        ) {
                            const rawVal = r[closedCol]?.v;
                            const parsed = Number(rawVal);
                            doneCount = isNaN(parsed) ? 0 : parsed;
                            foundClosed = true;
                            break;
                        }

                        const firstFew = r
                            .slice(0, 3)
                            .map((c: any) => String(c?.v || "").trim().toLowerCase());
                        if (
                            firstFew.includes("tasks") ||
                            (j > hRowIdx + 1 && firstFew.includes("crew"))
                        )
                            break;
                    }
                }
            }
            if (foundClosed) break;
        }

        // Phase 2: active tasks in the Tasks table
        for (let ri = 0; ri < rows.length; ri++) {
            const rowCells = rows[ri]?.c || [];
            let foundTasksTitle = false;

            for (let ci = 0; ci < rowCells.length; ci++) {
                const val = String(rowCells[ci]?.v || "").trim().toLowerCase();
                if (val === "tasks" || val === "task") {
                    foundTasksTitle = true;
                    break;
                }
            }

            if (foundTasksTitle) {
                let hRowIdx = -1;
                let tIdx = -1;
                let lIdx = -1;
                let sIdx = -1;

                for (let i = 0; i <= 5; i++) {
                    const checkRi = ri + i;
                    if (checkRi >= rows.length) break;
                    const row = rows[checkRi]?.c || [];

                    const taskHeaderIdx = row.findIndex((c: any) => {
                        const v = String(c?.v || "").toLowerCase().trim();
                        return v === "task" || v === "tasks";
                    });

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

                    const stageHeaderIdx = row.findIndex((c: any) => {
                        const v = String(c?.v || "").toLowerCase().trim();
                        return v === "stage" || v === "status";
                    });

                    if (taskHeaderIdx !== -1 && leadHeaderIdx !== -1) {
                        hRowIdx = checkRi;
                        tIdx = taskHeaderIdx;
                        lIdx = leadHeaderIdx;
                        sIdx = stageHeaderIdx;
                        break;
                    }
                }

                if (hRowIdx !== -1) {
                    for (let j = hRowIdx + 1; j < rows.length; j++) {
                        const r = rows[j]?.c || [];
                        if (!r || r.length === 0) continue;

                        const firstFew = r
                            .slice(0, 3)
                            .map((c: any) => String(c?.v || "").trim().toLowerCase());
                        if (
                            firstFew.includes("crew members") ||
                            firstFew.includes("about the crew")
                        )
                            break;

                        const taskCell = r[tIdx];
                        const leadIdCell = r[lIdx];
                        const stageCell = sIdx !== -1 ? r[sIdx] : null;

                        const taskLabel = String(taskCell?.v || "").trim();
                        const stageVal = String(stageCell?.v || "").trim().toLowerCase();
                        const isActive =
                            stageVal === "doing" ||
                            stageVal === "now" ||
                            stageVal === "in progress" ||
                            stageVal === "todo" ||
                            stageVal.includes("progress");

                        const v = String(leadIdCell?.v ?? "").trim().toLowerCase();
                        const f = String(leadIdCell?.f ?? "").trim().toLowerCase();

                        const prevCell = lIdx > 0 ? r[lIdx - 1] : null;
                        const pv = String(prevCell?.v ?? "").trim().toLowerCase();
                        const pf = String(prevCell?.f ?? "").trim().toLowerCase();

                        const nextCell = r[lIdx + 1];
                        const nv = String(nextCell?.v ?? "").trim().toLowerCase();
                        const nf = String(nextCell?.f ?? "").trim().toLowerCase();

                        const isMatch =
                            v === normalizedMemberId ||
                            f === normalizedMemberId ||
                            pv === normalizedMemberId ||
                            pf === normalizedMemberId ||
                            nv === normalizedMemberId ||
                            nf === normalizedMemberId;

                        if (isMatch && isActive && taskLabel) {
                            const taskUrl =
                                htmlLinkMap[taskLabel.trim()] ||
                                taskCell?.l ||
                                extractUrlFromText(taskLabel);
                            let cleanLabel = taskLabel;
                            if (taskUrl) {
                                const linkTextMatch = taskUrl.match(/https?:\/\/(.+)/);
                                if (linkTextMatch) {
                                    const linkCore = linkTextMatch[1].replace(/\/$/, "");
                                    const cleanRegex = new RegExp(
                                        `\\s*\\(?${linkCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?\\s*`,
                                        "i"
                                    );
                                    const candidate = taskLabel
                                        .replace(/\s*\(https?:\/\/[^\s\)]+\)\s*/g, " ")
                                        .replace(/https?:\/\/[^\s\)]+/g, "")
                                        .replace(cleanRegex, " ")
                                        .trim();
                                    if (candidate && candidate.length > 2) {
                                        cleanLabel = candidate;
                                    }
                                }
                            }
                            if (!myTasks.some((t) => t.label === cleanLabel)) {
                                myTasks.push({ label: cleanLabel, url: taskUrl });
                            }
                        }
                    }
                }
            }
        }

        return { active: myTasks, doneCount };
    } catch {
        return { active: [], doneCount: 0 };
    }
}
