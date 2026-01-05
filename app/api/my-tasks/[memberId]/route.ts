import { NextResponse } from "next/server";
import { getTaskLinks } from "../../lib/google-sheets";

const CREW_MAPPINGS_URL = "/api/crew-mappings"; // We'll fetch from our own API

// Simplified types for the tasks API
type Task = { label: string; url?: string };
type CrewTasks = { crewId: string; tasks: Task[] };
type CrewTaskData = { active: Task[]; doneCount: number; log?: string[] };

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

function extractUrlFromText(text: string): string | undefined {
    // 1. Try parentheses: (https://...)
    const parenMatch = text.match(/\((https?:\/\/[^\s\)]+)\)/);
    if (parenMatch) return parenMatch[1];
    // 2. Try raw URL: https://...
    const rawMatch = text.match(/https?:\/\/[^\s\)]+/);
    if (rawMatch) return rawMatch[0];
    // 3. Try common domains: rsv.pizza, rarepizzas.com
    const domainMatch = text.match(/([a-z A-Z0-9-]+\.(?:com|pizza|xyz|org|net|io|me))/i);
    if (domainMatch) return `https://${domainMatch[1]}`;
    return undefined;
}

// Fetch task links from published HTML (pubhtml)
// Legacy function removed
async function fetchTaskLinksFromHTML(sheetId: string) { return {}; }
/*
async function fetchTaskLinksFromHTML_LEGACY(sheetId: string): Promise<Record<string, string>> {
    const linkMap: Record<string, string> = {};
    try {
        const pubhtmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/pubhtml`;
        const res = await fetch(pubhtmlUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
            cache: "no-store"
        });

        if (!res.ok) {
            console.log(`[fetchTaskLinksFromHTML] Sheet not published or inaccessible (${res.status})`);
            return linkMap;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        // Find all tables and look for Tasks table
        $('table').each((_, table) => {
            const $table = $(table);
            let tasksHeaderRow: any = null;
            let taskColIdx = -1;

            // Find the "Tasks" anchor
            $table.find('tr').each((rowIdx, tr) => {
                const $tr = $(tr);
                const cells = $tr.find('td, th');
                cells.each((cellIdx, cell) => {
                    const text = $(cell).text().trim().toLowerCase();
                    if (text === 'tasks' || text === 'task') {
                        // Found anchor, next rows should have headers
                        tasksHeaderRow = $tr;
                        return false; // break
                    }
                });
                if (tasksHeaderRow) return false; // break outer
            });

            if (!tasksHeaderRow) return; // continue to next table

            // Find header row (should be 1-2 rows after anchor)
            const headerRowIdx = $table.find('tr').index(tasksHeaderRow);
            for (let offset = 1; offset <= 3; offset++) {
                const $headerRow = $table.find('tr').eq(headerRowIdx + offset);
                const headerCells = $headerRow.find('td, th');
                headerCells.each((idx, cell) => {
                    const text = $(cell).text().trim().toLowerCase();
                    if (text === 'task') {
                        taskColIdx = idx;
                        return false; // break
                    }
                });
                if (taskColIdx !== -1) break;
            }

            if (taskColIdx === -1) return; // No task column found

            // Extract links from task cells
            $table.find('tr').each((_, tr) => {
                const $tr = $(tr);
                const cells = $tr.find('td, th');
                const taskCell = cells.eq(taskColIdx);
                const $link = taskCell.find('a');

                if ($link.length > 0) {
                    const label = taskCell.text().trim();
                    const href = $link.attr('href');
                    if (label && href) {
                        linkMap[label] = href;
                    }
                }
            });
        });

        console.log(`[fetchTaskLinksFromHTML] Extracted ${Object.keys(linkMap).length} links from HTML`);
    } catch (e) {
        console.error('[fetchTaskLinksFromHTML] Error:', e);
    }
    return linkMap;
}
*/

// Google GViz wraps JSON inside a JS function call (copied from crew-mappings/route.ts)
function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const json = cleaned.slice(start, end + 1);
    return JSON.parse(json);
}

async function fetchMyTasksForCrew(sheetUrl: string, memberId: string): Promise<CrewTaskData> {
    const id = extractSheetId(sheetUrl);
    if (!id) return { active: [], doneCount: 0 };

    try {
        const url = gvizUrl(id); // default tab
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } });
        if (!res.ok) return { active: [], doneCount: 0 };

        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        const debugLog: string[] = [];
        const myTasks: Task[] = [];
        let doneCount = 0;
        const normalizedMemberId = String(memberId).trim().toLowerCase();
        debugLog.push(`Processing sheet for ${memberId}. Rows: ${rows.length}`);

        // Fetch links from Google Sheets API
        const sheetId = extractSheetId(sheetUrl);
        const htmlLinkMap = sheetId ? await getTaskLinks(sheetId) : {};
        debugLog.push(`Sheets API link map contains ${Object.keys(htmlLinkMap).length} entries`);


        // Phase 1: Look for "Closed" count in the "Crew" table
        let foundClosed = false;
        for (let ri = 0; ri < rows.length; ri++) {
            const rowCells = rows[ri]?.c || [];
            let crewTitleCol = -1;

            for (let ci = 0; ci < rowCells.length; ci++) {
                const v = String(rowCells[ci]?.v || "").trim().toLowerCase();
                const f = String(rowCells[ci]?.f || "").trim().toLowerCase();
                if (v.startsWith("crew") || f.startsWith("crew")) {
                    crewTitleCol = ci;
                    debugLog.push(`Found potential Crew anchor "${v || f}" at ri=${ri}, ci=${ci}`);
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

                    const rowVals = row.map((c: any) => String(c?.v || "").toLowerCase().trim());
                    const rowForms = row.map((c: any) => String(c?.f || "").toLowerCase().trim());

                    if (idCol === -1) {
                        const foundId = rowVals.indexOf("id") !== -1 ? rowVals.indexOf("id") : rowForms.indexOf("id");
                        if (foundId !== -1) {
                            idCol = foundId;
                            hRowIdx = checkRi; // Assume the row with ID starts the data/header area
                            debugLog.push(`Found ID header at ri=${checkRi}, col=${idCol}`);
                        }
                    }

                    if (closedCol === -1) {
                        const foundClosed = rowVals.indexOf("closed") !== -1 ? rowVals.indexOf("closed") : rowForms.indexOf("closed");
                        if (foundClosed !== -1) {
                            closedCol = foundClosed;
                            debugLog.push(`Found Closed header at ri=${checkRi}, col=${closedCol}`);
                        }
                    }

                    if (idCol !== -1 && closedCol !== -1) break;
                }

                // Fallback for Ops Crew: if ID is 1 and Closed is not found, try col 8 if it's "crew members"
                if (idCol !== -1 && closedCol === -1) {
                    debugLog.push(`Found ID but not Closed. Trying fallback column 8 for anchor "${String(rows[ri]?.c?.[crewTitleCol]?.v || "").toLowerCase()}"`);
                    closedCol = 8;
                }

                if (idCol !== -1 && closedCol !== -1) {
                    debugLog.push(`Scanning Crew table: ID col=${idCol}, Closed col=${closedCol}, data start ri=${hRowIdx + 1}`);
                    for (let j = hRowIdx + 1; j < rows.length; j++) {
                        const r = rows[j]?.c || [];
                        if (!r || r.length === 0) continue;

                        const idCellValue = String(r[idCol]?.v ?? "").trim().toLowerCase();
                        const idCellFormatted = String(r[idCol]?.f ?? "").trim().toLowerCase();

                        if (idCellValue === normalizedMemberId || idCellFormatted === normalizedMemberId) {
                            const rawVal = r[closedCol]?.v;
                            const parsed = Number(rawVal);
                            doneCount = isNaN(parsed) ? 0 : parsed;
                            debugLog.push(`Found Closed count in Crew table at ri=${j}: ${doneCount} (raw=${rawVal})`);
                            foundClosed = true;
                            break;
                        }

                        // Safety break - if we see "tasks" or another "crew" anchor in first few cols, stop
                        const firstFew = r.slice(0, 3).map((c: any) => String(c?.v || "").trim().toLowerCase());
                        if (firstFew.includes("tasks") || (j > hRowIdx + 1 && firstFew.includes("crew"))) break;
                    }
                }
            }
            if (foundClosed) break;
        }

        // Phase 2: Look for active tasks in the "Tasks" table
        for (let ri = 0; ri < rows.length; ri++) {
            const rowCells = rows[ri]?.c || [];
            let foundTasksTitle = false;
            let titleCol = -1;

            for (let ci = 0; ci < rowCells.length; ci++) {
                const val = String(rowCells[ci]?.v || "").trim().toLowerCase();
                if (val === "tasks" || val === "task") {
                    foundTasksTitle = true;
                    titleCol = ci;
                    debugLog.push(`Found Tasks anchor "${val}" at ri=${ri}, ci=${ci}`);
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
                    const rowVals = row.map((c: any) => String(c?.v || "").toLowerCase().trim());
                    debugLog.push(`Checking [Tasks] ri=${checkRi}. Vals: ${rowVals.slice(0, 10).join("|")}`);

                    const taskHeaderIdx = row.findIndex((c: any, ci: number) => {
                        const v = String(c?.v || "").toLowerCase().trim();
                        // Loosen check: allow includes "task" but try to avoid the titleCol 
                        // ONLY if there's no other task columns. Actually, if it's "task", it's likely a header.
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
                        debugLog.push(`Found Tasks headers at ri=${hRowIdx}: taskCol=${tIdx}, leadCol=${lIdx}, stageCol=${sIdx}`);
                        break;
                    }
                }

                if (hRowIdx !== -1) {
                    for (let j = hRowIdx + 1; j < rows.length; j++) {
                        const r = rows[j]?.c || [];
                        if (!r || r.length === 0) continue;

                        // Loosened break: only break if we see "crew members" or something clearly a new large section
                        const firstFew = r.slice(0, 3).map((c: any) => String(c?.v || "").trim().toLowerCase());
                        if (firstFew.includes("crew members") || firstFew.includes("about the crew")) break;

                        const taskCell = r[tIdx];
                        const leadIdCell = r[lIdx];
                        const stageCell = sIdx !== -1 ? r[sIdx] : null;

                        const taskLabel = String(taskCell?.v || "").trim();
                        const stageVal = String(stageCell?.v || "").trim().toLowerCase();
                        const isActive = stageVal === "doing" || stageVal === "now" || stageVal === "in progress" || stageVal === "todo" || stageVal.includes("progress");

                        const v = String(leadIdCell?.v ?? "").trim().toLowerCase();
                        const f = String(leadIdCell?.f ?? "").trim().toLowerCase();

                        const prevCell = lIdx > 0 ? r[lIdx - 1] : null;
                        const pv = String(prevCell?.v ?? "").trim().toLowerCase();
                        const pf = String(prevCell?.f ?? "").trim().toLowerCase();

                        const nextCell = r[lIdx + 1];
                        const nv = String(nextCell?.v ?? "").trim().toLowerCase();
                        const nf = String(nextCell?.f ?? "").trim().toLowerCase();

                        const isMatch = (v === normalizedMemberId || f === normalizedMemberId ||
                            pv === normalizedMemberId || pf === normalizedMemberId ||
                            nv === normalizedMemberId || nf === normalizedMemberId);

                        if (isMatch && isActive && taskLabel) {
                            debugLog.push(`MATCH found at ri=${j}: ${taskLabel} (stage=${stageVal}, searchCol=${lIdx}, foundId=${v || pv || nv})`);
                            // Priority: 1. HTML link map  2. GViz link  3. Text extraction
                            const taskUrl = htmlLinkMap[taskLabel.trim()] || taskCell?.l || extractUrlFromText(taskLabel);
                            let cleanLabel = taskLabel;
                            if (taskUrl) {
                                // Extract the core domain/path to match in text
                                const linkTextMatch = taskUrl.match(/https?:\/\/(.+)/);
                                if (linkTextMatch) {
                                    const linkCore = linkTextMatch[1].replace(/\/$/, "");
                                    const cleanRegex = new RegExp(`\\s*\\(?${linkCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?\\s*`, "i");
                                    const candidate = taskLabel.replace(/\s*\(https?:\/\/[^\s\)]+\)\s*/g, " ")
                                        .replace(/https?:\/\/[^\s\)]+/g, "")
                                        .replace(cleanRegex, " ")
                                        .trim();
                                    // Only use candidate if it's not empty and not just "()" etc
                                    if (candidate && candidate.length > 2) {
                                        cleanLabel = candidate;
                                    }
                                }
                            }
                            if (!myTasks.some(t => t.label === cleanLabel)) {
                                myTasks.push({ label: cleanLabel, url: taskUrl });
                                debugLog.push(`ADDED personal task: ${cleanLabel} (url=${taskUrl})`);
                            }
                        }
                    }
                }
            }
        }

        return { active: myTasks, doneCount, log: debugLog };
    } catch (e) {
        console.error("fetchMyTasksForCrew error:", e);
        return { active: [], doneCount: 0, log: [String(e)] };
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

        const sheetsToFetch = crews.filter((c: any) => c.sheet).map((c: any) => ({
            crewId: String(c.id).toLowerCase(),
            sheet: c.sheet,
        }));

        const allTasksByCrew: Record<string, Task[]> = {};
        const allDoneCounts: Record<string, number> = {};
        const debugLogs: Record<string, string[]> = {};

        // 2. Parallel fetch personalized tasks for each crew
        await Promise.all(
            sheetsToFetch.map(async (item: any) => {
                const { active, doneCount, log } = await fetchMyTasksForCrew(item.sheet, memberId);
                if (active.length > 0) {
                    allTasksByCrew[item.crewId] = active;
                }
                if (doneCount > 0) {
                    allDoneCounts[item.crewId] = doneCount;
                }
                if (log) {
                    debugLogs[item.crewId] = log;
                }
            })
        );

        return NextResponse.json({
            memberId,
            tasksByCrew: allTasksByCrew,
            doneCountsByCrew: allDoneCounts,
            debug: debugLogs
        });
    } catch (err: any) {
        return NextResponse.json({ error: String(err.message) }, { status: 500 });
    }
}
