// app/api/crew-mappings/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SHEET_ID = "19itGq86BRQTVehKhtRFKwK8gZqjsUQ_bG5cuVmem9HU";
const TAB_NAME = "Crew Mappings";

// Cache (best-effort, per-instance)
const memCache = new Map<string, { at: number; value: any }>();
const TTL_MS = 1000 * 60 * 10; // 10 minutes

function cacheGet(key: string) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key: string, value: any) {
  memCache.set(key, { at: Date.now(), value });
}

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

async function fetchCrewTasks(sheetUrl: string): Promise<{ label: string; url?: string }[]> {
  const id = extractSheetId(sheetUrl);
  if (!id) return [];

  try {
    const url = gvizUrl(id); // default tab
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 600 } });
    if (!res.ok) return [];
    const text = await res.text();
    const gviz = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];
    const cols = gviz?.table?.cols || [];

    // Find the cell containing "Tasks"
    let tasksRowIdx = -1;
    let tasksColIdx = -1;

    for (let ri = 0; ri < rows.length; ri++) {
      const rowCells = rows[ri]?.c || [];
      for (let ci = 0; ci < rowCells.length; ci++) {
        const val = String(rowCells[ci]?.v || "").trim().toLowerCase();
        // Look for the cell that contains exactly "tasks"
        if (val === "tasks") {
          tasksRowIdx = ri;
          tasksColIdx = ci;
          break;
        }
      }
      if (tasksRowIdx !== -1) break;
    }

    console.log(`[fetchCrewTasks] ${sheetUrl} - Tasks header found at: row ${tasksRowIdx}, col ${tasksColIdx} ("${String(rows[tasksRowIdx]?.c?.[tasksColIdx]?.v || "")}")`);

    if (tasksRowIdx === -1) {
      console.log(`[fetchCrewTasks] ${sheetUrl} - ERROR: No "Tasks" cell found in the first 100 rows.`);
      return [];
    }

    // The table is below the "Tasks" cell.
    // We'll search the next 3 rows for headers (Task, Stage)
    let headerRowIdx = -1;
    let stageIdx = -1;
    let taskIdx = -1;

    for (let i = 1; i <= 3; i++) {
      const ri = tasksRowIdx + i;
      if (ri >= rows.length) break;
      const row = rows[ri]?.c || [];

      const findCol = (name: string) =>
        row.findIndex((c: any) => String(c?.v || "").toLowerCase().includes(name.toLowerCase()));

      const sIdx = findCol("stage");
      const tIdx = findCol("task");

      if (tIdx !== -1) {
        headerRowIdx = ri;
        stageIdx = sIdx;
        taskIdx = tIdx;
        break;
      }
    }

    if (headerRowIdx === -1) {
      console.log(`[fetchCrewTasks] ${sheetUrl} - ERROR: Could not find headers (Task/Stage) near the "Tasks" cell.`);
      return [];
    }

    const headerLabels = (rows[headerRowIdx]?.c || []).map((h: any) => String(h?.v || "").trim());
    console.log(`[fetchCrewTasks] ${sheetUrl} - Found headers at row ${headerRowIdx}:`, headerLabels);
    console.log(`[fetchCrewTasks] ${sheetUrl} - Found stageIdx: ${stageIdx}, taskIdx: ${taskIdx}`);

    if (taskIdx === -1) return [];

    // Find priority column using the same findCol helper from header detection
    const headerRow = rows[headerRowIdx]?.c || [];
    const priorityIdx = headerRow.findIndex((c: any) => String(c?.v || "").toLowerCase().includes("priority"));

    // Collect all tasks with stage "now" or "doing" along with their priority
    const tasksWithMeta: { label: string; url?: string; priority: string }[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i]?.c || [];
      const stage = stageIdx !== -1 ? String(r[stageIdx]?.v || "").trim().toLowerCase() : "";

      const taskCell = r[taskIdx];
      const taskLabel = String(taskCell?.v || "").trim();
      const taskUrl = taskCell?.l || undefined; // GViz 'l' property contains the hyperlink
      const priority = priorityIdx !== -1 ? String(r[priorityIdx]?.v || "").trim().toLowerCase() : "";

      if (taskLabel && (stage === "now" || stage === "doing")) {
        tasksWithMeta.push({ label: taskLabel, url: taskUrl, priority });
      }
    }

    // Helper to get priority rank
    const getPriorityRank = (p: string) => {
      if (p.includes("top")) return 1;
      if (p.includes("high")) return 2;
      if (p.includes("mid")) return 3;
      if (p.includes("low")) return 4;
      return 999;
    };

    // Sort by priority
    tasksWithMeta.sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority));

    // Take top 3 and return without priority field
    const activeTasks = tasksWithMeta.slice(0, 3).map(t => ({ label: t.label, url: t.url }));

    return activeTasks;
  } catch (e) {
    console.error("fetchCrewTasks error:", e);
    return [];
  }
}

export async function GET() {
  try {
    const cacheKey = `crew-mappings:public-gviz:v3:${SHEET_ID}:${TAB_NAME}`;
    const cached = cacheGet(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });

    const url = gvizUrl(SHEET_ID, TAB_NAME);

    const res = await fetch(url, {
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
        `Failed to fetch sheet via GViz. status=${res.status} content-type=${contentType} url=${url} preview=${JSON.stringify(
          preview
        )}`
      );
    }

    if (raw.toLowerCase().includes("<html") || raw.toLowerCase().includes("<!doctype html")) {
      const preview = raw.slice(0, 260);
      throw new Error(
        `GViz returned HTML (not JSON). This usually means the sheet/tab isn't accessible via GViz.
content-type=${contentType} url=${url} preview=${JSON.stringify(preview)}`
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

    // Parallel fetch tasks for crews that have a sheet
    await Promise.all(
      crews.map(async (c) => {
        if (c.sheet) {
          c.tasks = await fetchCrewTasks(c.sheet);
        }
      })
    );

    const payload = { crews };
    cacheSet(cacheKey, payload);

    return NextResponse.json({ ...payload, cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? "Unknown error") }, { status: 500 });
  }
}
