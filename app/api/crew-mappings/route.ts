import { NextResponse } from "next/server";
import { getTaskLinks, getColumnHyperlinks } from "../lib/google-sheets";
import { cacheGet, cacheSet, cacheDel, CACHE_TTL } from "../lib/cache";
import promiseLimit from "promise-limit";

export const runtime = "nodejs";

const SHEET_ID = "19itGq86BRQTVehKhtRFKwK8gZqjsUQ_bG5cuVmem9HU";
const TAB_NAME = "Crew Mappings";

function normalizeSpaces(s: unknown) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function slugify(s: unknown) {
  return normalizeSpaces(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitList(s: unknown) {
  // handles: "Leonardo, Donatello" or "Leonardo / Donatello" or "Leonardo|Donatello"
  return normalizeSpaces(s)
    .split(/[,/|]+/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);
}

type CrewOption = {
  id: string;
  label: string; // Crew
  turtles: string[];
  role?: string;
  channel?: string;
  event?: string;
  emoji?: string;
  sheet?: string;
  callTime?: string;
  callTimeUrl?: string; // Calendar event link
  callLength?: string;
  tasks?: { label: string; url?: string }[];
};

// Google GViz wraps JSON inside a JS function call
function parseGvizJson(text: string) {
  // It can start with: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    const preview = cleaned.slice(0, 220);
    throw new Error(`GViz: Unexpected response (no JSON object). Preview: ${JSON.stringify(preview)}`);
  }

  const json = cleaned.slice(start, end + 1);
  return JSON.parse(json);
}

function gvizUrl(sheetId: string, tabName?: string) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  if (tabName) url.searchParams.set("sheet", tabName);
  url.searchParams.set("headers", "1");
  return url.toString();
}

function extractSheetId(url: string) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function extractUrlFromText(text: string): string | undefined {
  // 1. Try parentheses: (https://...)
  const parenMatch = text.match(/\((https?:\/\/[^\s\)]+)\)/);
  if (parenMatch) return parenMatch[1];
  // 2. Try raw URL: https://...
  const rawMatch = text.match(/https?:\/\/[^\s\)]+/);
  if (rawMatch) return rawMatch[0];
  // 3. Try common domains: rsv.pizza, rarepizzas.com
  const domainMatch = text.match(/([a-zA-Z0-9-]+\.(?:com|pizza|xyz|org|net|io|me))/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  return undefined;
}

// Fetch task links from published HTML (pubhtml) - copied from my-tasks
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

async function fetchCrewTasks(sheetUrl: string): Promise<{ label: string; url?: string }[]> {
  const id = extractSheetId(sheetUrl);
  if (!id) return [];

  try {
    const url = gvizUrl(id); // default tab
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } });
    if (!res.ok) return [];
    const text = await res.text();
    const gviz = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];
    const cols = gviz?.table?.cols || [];

    // Find the cell containing "Tasks" or "Task"
    let tasksRowIdx = -1;
    let tasksColIdx = -1;

    for (let ri = 0; ri < rows.length; ri++) {
      const rowCells = rows[ri]?.c || [];
      for (let ci = 0; ci < rowCells.length; ci++) {
        const val = String(rowCells[ci]?.v || "").trim().toLowerCase();
        if (val === "tasks" || val === "task") {
          tasksRowIdx = ri;
          tasksColIdx = ci;
          break;
        }
      }
      if (tasksRowIdx !== -1) break;
    }

    if (tasksRowIdx === -1) return [];

    let headerRowIdx = -1;
    let stageIdx = -1;
    let taskIdx = -1;

    for (let i = 0; i <= 3; i++) {
      const ri = tasksRowIdx + i;
      if (ri >= rows.length) break;
      const row = rows[ri]?.c || [];
      const findCol = (name: string) =>
        row.findIndex((c: any) => String(c?.v || "").toLowerCase().trim() === name.toLowerCase());

      const sIdx = findCol("stage");
      const tIdx = findCol("task");

      if (tIdx !== -1) {
        headerRowIdx = ri;
        stageIdx = sIdx;
        taskIdx = tIdx;
        break;
      }
    }

    if (headerRowIdx === -1) return [];

    const headerRow = rows[headerRowIdx]?.c || [];
    const priorityIdx = headerRow.findIndex((c: any) => String(c?.v || "").toLowerCase().includes("priority"));

    // Fetch links from Google Sheets API
    const htmlLinkMap = await getTaskLinks(id);

    const tasksWithMeta: { label: string; url?: string; priority: string }[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i]?.c || [];
      const stage = stageIdx !== -1 ? String(r[stageIdx]?.v || "").trim().toLowerCase() : "";
      const isActive = stage === "now" || stage === "doing" || stage === "in progress" || stage === "todo" || stage.includes("progress");

      const taskCell = r[taskIdx];
      const rawLabel = String(taskCell?.v || "").trim();
      // Priority: 1. HTML link map  2. GViz link  3. Text extraction
      const taskUrl = htmlLinkMap[rawLabel] || taskCell?.l || extractUrlFromText(rawLabel);
      // Clean label if it has the URL in it
      const taskLabel = rawLabel.replace(/\s*\(https?:\/\/[^\s\)]+\)\s*/g, " ").trim();
      const priority = priorityIdx !== -1 ? String(r[priorityIdx]?.v || "").trim().toLowerCase() : "";

      if (taskLabel && isActive) {
        tasksWithMeta.push({ label: taskLabel, url: taskUrl, priority });
      }
    }

    const getPriorityRank = (p: string) => {
      if (p.includes("top")) return 1;
      if (p.includes("high")) return 2;
      if (p.includes("mid")) return 3;
      if (p.includes("low")) return 4;
      return 999;
    };

    tasksWithMeta.sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority));
    return tasksWithMeta.slice(0, 3).map(t => ({ label: t.label, url: t.url }));
  } catch (e) {
    console.error("fetchCrewTasks error:", e);
    return [];
  }
}

export async function GET(req: Request) {
  try {
    // Check for ?fresh=1 to skip cache
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('fresh') === '1';

    const cacheKey = `crew-mappings:v7:${SHEET_ID}`;

    if (!forceRefresh) {
      const cached = await cacheGet<{ crews: any[] }>(cacheKey);
      if (cached) {
        console.log('[crew-mappings] Cache hit');
        return NextResponse.json({ ...cached, cached: true });
      }
    }

    console.log('[crew-mappings] Cache miss, fetching fresh data');

    const gvizEndpoint = gvizUrl(SHEET_ID, TAB_NAME);

    const res = await fetch(gvizEndpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/plain,*/*",
      },
      cache: "no-store",
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();

    if (!res.ok) {
      const preview = raw.slice(0, 240);
      throw new Error(
        `Failed to fetch sheet via GViz. status=${res.status} content-type=${contentType} url=${gvizEndpoint} preview=${JSON.stringify(
          preview
        )}`
      );
    }

    if (raw.toLowerCase().includes("<html") || raw.toLowerCase().includes("<!doctype html")) {
      const preview = raw.slice(0, 260);
      throw new Error(
        `GViz returned HTML (not JSON). This usually means the sheet/tab isn't accessible via GViz.
content-type=${contentType} url=${gvizEndpoint} preview=${JSON.stringify(preview)}`
      );
    }

    const gviz = parseGvizJson(raw);

    const table = gviz?.table;
    const cols: any[] = Array.isArray(table?.cols) ? table.cols : [];
    const rows: any[] = Array.isArray(table?.rows) ? table.rows : [];

    const cell = (r: any, i: number) => {
      if (i < 0) return "";
      const v = r?.c?.[i];
      return normalizeSpaces(v?.f ?? v?.v ?? "");
    };

    // 1) Prefer column labels if present
    let headers = cols.map((c) => normalizeSpaces(c?.label ?? ""));
    const allBlank = headers.every((h) => !h);

    // 2) If GViz gave blank labels, fall back to using the first row as headers
    let dataRows = rows;
    if (allBlank) {
      const firstRow = rows[0];
      if (!firstRow) {
        throw new Error(`No rows found in "${TAB_NAME}" tab (and column labels were blank).`);
      }
      headers = cols.map((_, i) => cell(firstRow, i));
      dataRows = rows.slice(1);
    }

    const idx = (name: string) =>
      headers.findIndex((h) => normalizeSpaces(h).toLowerCase() === name.toLowerCase());

    const crewIdx = idx("Crew");
    if (crewIdx === -1) {
      throw new Error(`Missing required column "Crew". Found: ${headers.join(", ")}`);
    }

    const turtlesIdx = idx("Turtles");
    const roleIdx = idx("Role");
    const channelIdx = idx("Channel");
    const eventIdx = idx("Event");
    const emojiIdx = idx("Emoji");

    // Flexible matching for Call Time and Call Length
    const findFuzzy = (subs: string[]) =>
      headers.findIndex((h) => {
        const normH = normalizeSpaces(h).toLowerCase();
        return subs.some((s) => normH.includes(s.toLowerCase()));
      });

    const sheetIdx = findFuzzy(["Sheet", "URL", "Link"]);
    const callTimeIdx = findFuzzy(["Call Time", "Call (", "Call Day"]);
    const callLengthIdx = findFuzzy(["Call Length", "Length", "Duration"]);

    const byId = new Map<string, CrewOption>();

    for (const r of dataRows) {
      const crew = cell(r, crewIdx);
      if (!crew) continue;

      const id = slugify(crew) || crew.toLowerCase();

      const turtles = turtlesIdx !== -1 ? splitList(cell(r, turtlesIdx)) : [];
      const role = roleIdx !== -1 ? cell(r, roleIdx) : "";
      const channel = channelIdx !== -1 ? cell(r, channelIdx) : "";
      const event = eventIdx !== -1 ? cell(r, eventIdx) : "";
      const emoji = emojiIdx !== -1 ? cell(r, emojiIdx) : "";
      const sheet = sheetIdx !== -1 ? cell(r, sheetIdx) : "";
      const callTime = callTimeIdx !== -1 ? cell(r, callTimeIdx) : "";
      const callLength = callLengthIdx !== -1 ? cell(r, callLengthIdx) : "";

      const existing = byId.get(id);
      if (existing) {
        for (const t of turtles) if (!existing.turtles.includes(t)) existing.turtles.push(t);
        if (!existing.role && role) existing.role = role;
        if (!existing.channel && channel) existing.channel = channel;
        if (!existing.event && event) existing.event = event;
        if (!existing.emoji && emoji) existing.emoji = emoji;
        if (!existing.sheet && sheet) existing.sheet = sheet;
        if (!existing.callTime && callTime) existing.callTime = callTime;
        if (!existing.callLength && callLength) existing.callLength = callLength;
      } else {
        byId.set(id, {
          id,
          label: crew,
          turtles,
          role: role || undefined,
          channel: channel || undefined,
          event: event || undefined,
          emoji: emoji || undefined,
          sheet: sheet || undefined,
          callTime: callTime || undefined,
          callLength: callLength || undefined,
          tasks: [],
        });
      }
    }

    const crews = Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));

    // Fetch calendar event links from Call Time column
    const callTimeLinks = await getColumnHyperlinks(SHEET_ID, TAB_NAME, "Crew", "Call Time");
    for (const c of crews) {
      if (callTimeLinks[c.label]) {
        c.callTimeUrl = callTimeLinks[c.label];
      }
    }

    // Parallel fetch tasks for crews that have a sheet
    // Limit concurrency to avoid 429s (sheets quota is ~60/min but heavier calls are lower)
    const limit = promiseLimit(3);

    await Promise.all(
      crews.map((c) => limit(async () => {
        if (c.sheet) {
          c.tasks = await fetchCrewTasks(c.sheet);
        }
      }))
    );

    const payload = { crews };
    await cacheSet(cacheKey, payload, CACHE_TTL.CREW_MAPPINGS);

    return NextResponse.json({ ...payload, cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? "Unknown error") }, { status: 500 });
  }
}
