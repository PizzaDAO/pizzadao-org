#!/usr/bin/env node
/**
 * Import old community calls from X live broadcasts (plans/x-call-import.md). Runs on the OPERATOR'S
 * machine, never on Vercel. DRY RUN BY DEFAULT: without --apply nothing is downloaded, written to the
 * database or uploaded; each step prints what it would do (discover and the other local steps print counts).
 *
 * Steps, in order (each is resumable; state per call in <workdir>/state/<key>.json, never transcript text):
 *   discover --archive <dir> [--csv <file>]   find broadcast links in the X data archive (tweets*.js) and a manual CSV -> manifest.csv
 *   probe                                     yt-dlp --dump-json per included row: replay still there? duration, start time
 *   fetch                                     yt-dlp (HLS replay) + ffmpeg: AUDIO ONLY -> work/<key>.wav (16 kHz mono), out/<key>/mix.m4a
 *   transcribe                                whisper.cpp (-mc 0 -sns --vad) -> work/<key>.whisper.json
 *   diarize                                   pyannote via scripts/calls/x-import/diarize.py -> work/<key>.rttm
 *   merge                                     whisper + diarization by overlap -> out/<key>/import.json (xs:N speakers); prints counts only
 *   upload                                    mix.m4a + raw whisper/RTTM to R2 with the write-capable token (skips unchanged sha256)
 *   import                                    validate and store the call as IN_REVIEW (never overwrites published / rejected / edited calls)
 *   summarize [--limit N]                     AI title / summary / chapters / action items, one call at a time
 *   delete --only <key,...>                   remove imported rows from the database (e.g. a test import); never published or Discord calls
 *   status                                    one line per call
 *   run --from <step> --to <step> [--only k1,k2]   chain the steps above
 *
 * Common flags: --workdir <dir> (default ~/pizzadao-x-import), --env <file> (KEY=VALUE lines, mode 600,
 * outside the repo), --only <key,...>, --apply, --force (redo a finished step / replace an unpublished call
 * a reviewer touched), --min-minutes <n> (default 10; manifest include=short overrides), --delay-sec <n>
 * (pause between downloads, default 30), --cookies-from-browser <browser> (only if X needs a login for replays),
 * --keep-raw (keep the downloaded stream; default deletes it once the audio is extracted), --lang <code>,
 * --model <file>, --vad-model <file>, --whisper-bin <path>, --python <path>, --max-speakers <n>.
 *
 * Environment (names only; values live in the --env file): DATABASE_URL, AI_GATEWAY_API_KEY, OPENAI_API_KEY (fallback),
 * HF_TOKEN (pyannote), X_IMPORT_R2_ENDPOINT, X_IMPORT_R2_BUCKET, X_IMPORT_R2_ACCESS_KEY_ID, X_IMPORT_R2_SECRET_ACCESS_KEY
 * (a write-capable token, separate from the app's read-only R2_* token), IMPORT_OPERATOR_DISCORD_ID.
 * The 20261104000000_call_import migration must be applied first. See docs/x-call-import.md.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help", "force", "keep-raw"] });
if (args.help || !args._[0]) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(args.help ? 0 : 1);
}

const cmd = args._[0];
const apply = !!args.apply;
const force = !!args.force;
const workdir = path.resolve(String(args.workdir && args.workdir !== true ? args.workdir : path.join(homedir(), "pizzadao-x-import")));
const minMinutes = numArg("min-minutes", 10);
const delaySec = numArg("delay-sec", 30);
const only = args.only && args.only !== true ? new Set(String(args.only).split(",").map((s) => s.trim()).filter(Boolean)) : null;

function numArg(name, fallback) {
  if (args[name] === undefined) return fallback;
  const n = Number(args[name]);
  if (!Number.isFinite(n) || n < 0) die(`--${name} must be a non-negative number`);
  return n;
}

// ---- env file (never printed) ----

function loadEnvFile(file) {
  const p = path.resolve(file);
  if (!existsSync(p)) die(`--env file not found: ${p}`);
  if ((statSync(p).mode & 0o077) !== 0) die(`--env file ${p} is readable by others: chmod 600 it`);
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
if (args.env && args.env !== true) loadEnvFile(String(args.env));

// The app modules create a database client when imported; a placeholder keeps the local-only steps working without a database.
const hasDb = !!process.env.DATABASE_URL?.trim();
if (!hasDb) process.env.DATABASE_URL = "postgresql://placeholder.invalid/none";
const needDb = () => { if (!hasDb) die("this step needs DATABASE_URL in the environment (--env file)"); };

const need = (...names) => {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) die(`missing in the environment (--env file): ${missing.join(", ")}`);
};

// ---- small helpers ----

const dirs = {
  state: path.join(workdir, "state"),
  raw: path.join(workdir, "raw"),
  work: path.join(workdir, "work"),
  out: path.join(workdir, "out"),
  models: path.join(workdir, "models"),
};
const manifestPath = path.join(workdir, "manifest.csv");
const ensureDirs = () => Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));

/** Run a program with an argument array (no shell). Output is inherited only when asked: logs may name private paths. */
function run(bin, argv, { capture = false, quiet = false } = {}) {
  const r = spawnSync(bin, argv, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : quiet ? "ignore" : "inherit", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`${bin}: ${r.error.message}`);
  return r;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

const statePath = (key) => path.join(dirs.state, `${key}.json`);
function loadState(key) {
  try {
    return JSON.parse(readFileSync(statePath(key), "utf8"));
  } catch {
    return { key };
  }
}
function saveState(st) {
  const tmp = `${statePath(st.key)}.tmp`;
  writeFileSync(tmp, JSON.stringify(st, null, 2));
  renameSync(tmp, statePath(st.key));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanErr = (e) => String(e instanceof Error ? e.message : e).replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, "").replace(/\s+/g, " ").slice(0, 300);

const lib = {
  archive: await importApp("app/lib/calls/import-archive.ts"),
  merge: await importApp("app/lib/calls/import-merge.ts"),
};

function loadManifest() {
  if (!existsSync(manifestPath)) die(`no manifest at ${manifestPath}: run "discover" first`);
  return lib.archive.parseManifest(readFileSync(manifestPath, "utf8"));
}

/** Included rows (include=y, or short), narrowed by --only. */
function selectRows() {
  const rows = [];
  for (const raw of loadManifest()) {
    if (!["y", "short"].includes(raw.include.toLowerCase()) || (only && !only.has(raw.key) && !only.has(raw.external_id))) continue;
    const row = lib.archive.validateManifestRow(raw);
    if (!row) { console.error(`${raw.key || "(row without key)"}: skipped, the key / external_id do not match x-broadcast-<id>`); continue; }
    rows.push(row);
  }
  return rows;
}

const paths = (key) => ({
  wav: path.join(dirs.work, `${key}.wav`),
  whisper: path.join(dirs.work, `${key}.whisper.json`),
  rttm: path.join(dirs.work, `${key}.rttm`),
  outDir: path.join(dirs.out, key),
  m4a: path.join(dirs.out, key, "mix.m4a"),
  merged: path.join(dirs.out, key, "import.json"),
});

// ---- steps ----

async function discover() {
  const archiveDir = args.archive && args.archive !== true ? path.resolve(String(args.archive)) : null;
  if (!archiveDir && !args.csv) die("discover needs --archive <unzipped archive dir> and/or --csv <file>");
  let candidates = [];
  if (archiveDir) {
    const dataDir = existsSync(path.join(archiveDir, "data")) ? path.join(archiveDir, "data") : archiveDir;
    const files = readdirSync(dataDir).filter((f) => /^tweets?(-part\d+)?\.js$/.test(f));
    if (!files.length) die(`no tweets.js found in ${dataDir}`);
    const tweets = files.flatMap((f) => lib.archive.parseArchiveJs(readFileSync(path.join(dataDir, f), "utf8")));
    candidates = lib.archive.discoverBroadcasts(tweets);
    console.log(`archive: ${tweets.length} posts, ${candidates.length} distinct broadcast link(s)`);
  }
  let manual = [];
  if (args.csv && args.csv !== true) {
    const parsed = lib.archive.parseManualCsv(readFileSync(path.resolve(String(args.csv)), "utf8"));
    manual = parsed.rows;
    console.log(`manual csv: ${manual.length} usable row(s)${parsed.rejected.length ? `, unusable line(s): ${parsed.rejected.join(", ")}` : ""}`);
  }
  const existing = existsSync(manifestPath) ? lib.archive.parseManifest(readFileSync(manifestPath, "utf8")) : [];
  const rows = lib.archive.buildManifest(existing, candidates, manual);
  console.log(`manifest: ${rows.length} row(s) (${rows.length - existing.length} new)`);
  if (!apply) return console.log("Dry run: manifest not written. Re-run with --apply, then set include=y on the calls to import.");
  ensureDirs();
  writeFileSync(manifestPath, lib.archive.manifestToCsv(rows));
  console.log(`Wrote ${manifestPath}. Set include=y (or short for calls under ${minMinutes} min) on the rows to import, and fix titles / crew_id.`);
}

async function probe() {
  const rows = selectRows();
  console.log(`${rows.length} included row(s)`);
  if (!apply) return console.log("Dry run: would run yt-dlp --dump-json for each row without a probe. Re-run with --apply.");
  ensureDirs();
  const all = loadManifest();
  try {
    for (const row of rows) {
      const st = loadState(row.key);
      if (st.probe && !force) continue;
      try {
        const argv = ["--dump-json", "--no-playlist", "--skip-download", ...(args["cookies-from-browser"] && args["cookies-from-browser"] !== true ? ["--cookies-from-browser", String(args["cookies-from-browser"])] : []), "--", row.url];
        const r = run("yt-dlp", argv, { capture: true });
        if (r.status !== 0) {
          st.probe = { status: /unavailable|not found|404|gone|ended|no longer/i.test(r.stderr ?? "") ? "gone" : "error", at: new Date().toISOString() };
        } else {
          const info = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("{")) ?? "{}");
          const ts = info.timestamp ?? info.release_timestamp ?? null;
          st.probe = { status: "ok", at: new Date().toISOString(), durationSec: Math.round(info.duration ?? 0) || null, startedAt: ts ? new Date(ts * 1000).toISOString() : null };
          const m = all.find((x) => x.key === row.key);
          if (m && st.probe.startedAt) m.started_at_utc = st.probe.startedAt;
          if (m && !m.title && typeof info.title === "string") m.title = info.title.slice(0, 200);
        }
      } catch (e) {
        // One bad answer (unreadable JSON, tool missing) must not lose the rows already probed.
        st.probe = { status: "error", at: new Date().toISOString() };
        st.error = { step: "probe", message: cleanErr(e) };
      }
      saveState(st);
      console.log(`${row.key}: ${st.probe.status}${st.probe.durationSec ? `, ${Math.round(st.probe.durationSec / 60)} min` : ""}`);
      await sleep(2000);
    }
  } finally {
    writeFileSync(manifestPath, lib.archive.manifestToCsv(all));
  }
}

async function fetchStep() {
  const rows = selectRows();
  console.log(`${rows.length} included row(s)`);
  let first = true;
  for (const row of rows) {
    const st = loadState(row.key);
    const p = paths(row.key);
    if (st.probe?.status === "gone") { console.log(`${row.key}: replay is gone, skipped`); continue; }
    if (st.fetch && existsSync(p.wav) && existsSync(p.m4a) && !force) { console.log(`${row.key}: already fetched`); continue; }
    if (st.probe?.durationSec && st.probe.durationSec < minMinutes * 60 && row.include.toLowerCase() !== "short") {
      console.log(`${row.key}: skip: too-short (${Math.round(st.probe.durationSec / 60)} min < ${minMinutes}); set include=short to import it anyway`);
      continue;
    }
    if (!apply) { console.log(`${row.key}: would download the replay (audio only) and extract wav + m4a`); continue; }
    ensureDirs();
    if (!first) await sleep(delaySec * 1000);
    first = false;
    try {
      mkdirSync(p.outDir, { recursive: true });
      const dl = ["--no-playlist", "-f", "bestaudio/worst", "--continue", "--retries", "10", "--fragment-retries", "20", "--sleep-requests", "2", "--limit-rate", String(args["limit-rate"] ?? "2M"), "--no-warnings", "-o", path.join(dirs.raw, `${row.key}.%(ext)s`),
        ...(args["cookies-from-browser"] && args["cookies-from-browser"] !== true ? ["--cookies-from-browser", String(args["cookies-from-browser"])] : []), "--", row.url];
      const r = run("yt-dlp", dl);
      if (r.status !== 0) throw new Error(`yt-dlp exited ${r.status}`);
      const rawFile = readdirSync(dirs.raw).filter((f) => f.startsWith(`${row.key}.`) && !/\.(part|ytdl)$/.test(f)).map((f) => path.join(dirs.raw, f))[0];
      if (!rawFile) throw new Error("no downloaded file found");
      const ff = ["-nostdin", "-y", "-v", "error", "-i", rawFile, "-vn"];
      if (run("ffmpeg", [...ff, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", p.wav]).status !== 0) throw new Error("ffmpeg (wav) failed");
      if (run("ffmpeg", [...ff, "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", p.m4a]).status !== 0) throw new Error("ffmpeg (m4a) failed");
      const dur = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", p.wav], { capture: true }).stdout.trim());
      if (!Number.isFinite(dur) || dur <= 0) throw new Error("could not read the audio duration");
      st.fetch = { at: new Date().toISOString(), durationSec: Math.round(dur), sha256: { raw: await sha256File(rawFile), wav: await sha256File(p.wav), m4a: await sha256File(p.m4a) }, m4aBytes: statSync(p.m4a).size };
      if (!args["keep-raw"]) rmSync(rawFile, { force: true });
      if (st.fetch.durationSec < minMinutes * 60 && row.include.toLowerCase() !== "short") { st.skip = "too-short"; console.log(`${row.key}: skip: too-short after download`); } else delete st.skip;
      delete st.error;
      console.log(`${row.key}: fetched, ${Math.round(st.fetch.durationSec / 60)} min`);
    } catch (e) {
      st.error = { step: "fetch", message: cleanErr(e) };
      console.error(`${row.key}: fetch failed: ${st.error.message}`);
    }
    saveState(st);
  }
}

async function transcribeStep() {
  const model = String(args.model && args.model !== true ? args.model : path.join(dirs.models, "ggml-large-v3-turbo.bin"));
  const vadModel = String(args["vad-model"] && args["vad-model"] !== true ? args["vad-model"] : path.join(dirs.models, "ggml-silero-v5.1.2.bin"));
  const bin = String(args["whisper-bin"] && args["whisper-bin"] !== true ? args["whisper-bin"] : "whisper-cli");
  const rows = selectRows();
  for (const row of rows) {
    const st = loadState(row.key);
    const p = paths(row.key);
    if (!st.fetch || st.skip) { console.log(`${row.key}: not fetched${st.skip ? ` (${st.skip})` : ""}, skipped`); continue; }
    if (st.transcribe && existsSync(p.whisper) && !force) { console.log(`${row.key}: already transcribed`); continue; }
    if (!apply) { console.log(`${row.key}: would run ${bin} (-mc 0 -sns --vad)`); continue; }
    if (!existsSync(model)) die(`whisper model not found: ${model} (see docs/x-call-import.md)`);
    if (!existsSync(vadModel)) die(`VAD model not found: ${vadModel}`);
    try {
      const argv = ["-m", model, "-f", p.wav, "-l", String(args.lang ?? "en"), "-mc", "0", "-sns", "--vad", "-vm", vadModel, "-vt", "0.5", "-ojf", "-of", path.join(dirs.work, `${row.key}.whisper`)];
      if (run(bin, argv, { quiet: true }).status !== 0) throw new Error(`${bin} failed`);
      if (!existsSync(p.whisper)) throw new Error("no whisper output found");
      st.transcribe = { at: new Date().toISOString(), model: path.basename(model), vadModel: path.basename(vadModel), flags: "-mc 0 -sns --vad -vt 0.5", sha256: await sha256File(p.whisper) };
      delete st.error;
      console.log(`${row.key}: transcribed`);
    } catch (e) {
      st.error = { step: "transcribe", message: cleanErr(e) };
      console.error(`${row.key}: transcribe failed: ${st.error.message}`);
    }
    saveState(st);
  }
}

async function diarizeStep() {
  const py = String(args.python && args.python !== true ? args.python : path.join(workdir, ".venv", "bin", "python"));
  const rows = selectRows();
  for (const row of rows) {
    const st = loadState(row.key);
    const p = paths(row.key);
    if (!st.fetch || st.skip) { console.log(`${row.key}: not fetched, skipped`); continue; }
    if (st.diarize && existsSync(p.rttm) && !force) { console.log(`${row.key}: already diarized`); continue; }
    if (!apply) { console.log(`${row.key}: would run pyannote (diarize.py)`); continue; }
    need("HF_TOKEN");
    if (!existsSync(py)) die(`python not found at ${py} (see docs/x-call-import.md for the venv)`);
    try {
      const argv = ["-I", path.join(HERE, "x-import", "diarize.py"), "--wav", p.wav, "--out", p.rttm, ...(args["max-speakers"] ? ["--max-speakers", String(args["max-speakers"])] : []), ...(args["min-speakers"] ? ["--min-speakers", String(args["min-speakers"])] : []), ...(args["num-speakers"] ? ["--num-speakers", String(args["num-speakers"])] : [])];
      if (run(py, argv, { quiet: false }).status !== 0) throw new Error("diarize.py failed");
      st.diarize = { at: new Date().toISOString(), engine: "pyannote", sha256: await sha256File(p.rttm) };
      delete st.error;
      console.log(`${row.key}: diarized`);
    } catch (e) {
      st.error = { step: "diarize", message: cleanErr(e) };
      console.error(`${row.key}: diarize failed: ${st.error.message}`);
    }
    saveState(st);
  }
}

async function mergeStep() {
  const rows = selectRows();
  for (const row of rows) {
    const st = loadState(row.key);
    const p = paths(row.key);
    if (!st.transcribe || !st.diarize) { console.log(`${row.key}: needs transcribe and diarize first, skipped`); continue; }
    if (st.merge && existsSync(p.merged) && !force) { console.log(`${row.key}: already merged`); continue; }
    if (!apply) { console.log(`${row.key}: would merge whisper + diarization`); continue; }
    try {
      const segments = lib.merge.parseWhisperJson(JSON.parse(readFileSync(p.whisper, "utf8")));
      const turns = lib.merge.parseRttm(readFileSync(p.rttm, "utf8"));
      const result = lib.merge.mergeTranscript({ segments, turns, durationMs: st.fetch.durationSec * 1000 });
      mkdirSync(p.outDir, { recursive: true });
      writeFileSync(p.merged, JSON.stringify({ durationSec: st.fetch.durationSec, segments: result.segments, speakers: result.speakers.map((s) => ({ id: s.id, talkTimeSec: s.talkTimeSec })), stats: result.stats }));
      st.merge = { at: new Date().toISOString(), stats: result.stats, speakers: result.speakers.length };
      delete st.error;
      const s = result.stats;
      console.log(`${row.key}: ${result.segments.length} lines, ${result.speakers.length} speaker(s), ${s.words} words, ${s.unattributed} unattributed, dropped ${s.droppedDubious} dubious / ${s.droppedRepeats} repeats`);
    } catch (e) {
      st.error = { step: "merge", message: cleanErr(e) };
      console.error(`${row.key}: merge failed: ${st.error.message}`);
    }
    saveState(st);
  }
}

async function uploadStep() {
  const rows = selectRows();
  let s3 = null;
  for (const row of rows) {
    const st = loadState(row.key);
    const p = paths(row.key);
    if (!st.merge) { console.log(`${row.key}: not merged yet, skipped`); continue; }
    if (!apply) { console.log(`${row.key}: would upload calls/${row.key}/mix.m4a (+ import/ files) if its sha256 changed`); continue; }
    need("X_IMPORT_R2_ENDPOINT", "X_IMPORT_R2_BUCKET", "X_IMPORT_R2_ACCESS_KEY_ID", "X_IMPORT_R2_SECRET_ACCESS_KEY");
    const { S3Client, HeadObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
    s3 ??= new S3Client({ region: "auto", endpoint: process.env.X_IMPORT_R2_ENDPOINT, credentials: { accessKeyId: process.env.X_IMPORT_R2_ACCESS_KEY_ID, secretAccessKey: process.env.X_IMPORT_R2_SECRET_ACCESS_KEY } });
    const Bucket = process.env.X_IMPORT_R2_BUCKET;
    try {
      const files = [
        { key: `calls/${row.key}/mix.m4a`, file: p.m4a, type: "audio/mp4" },
        { key: `calls/${row.key}/import/transcript.raw.json`, file: p.whisper, type: "application/json" },
        { key: `calls/${row.key}/import/diarization.rttm`, file: p.rttm, type: "text/plain" },
      ];
      let sent = 0;
      for (const f of files) {
        const sha = await sha256File(f.file);
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: f.key })).catch(() => null);
        if (head?.Metadata?.sha256 === sha) continue;
        await s3.send(new PutObjectCommand({ Bucket, Key: f.key, Body: readFileSync(f.file), ContentType: f.type, Metadata: { sha256: sha } }));
        sent++;
      }
      st.upload = { at: new Date().toISOString(), mixKey: files[0].key, mixBytes: statSync(p.m4a).size };
      delete st.error;
      console.log(`${row.key}: uploaded ${sent} of ${files.length} object(s)`);
    } catch (e) {
      st.error = { step: "upload", message: cleanErr(e) };
      console.error(`${row.key}: upload failed: ${st.error.message}`);
    }
    saveState(st);
  }
}

async function importStep() {
  // Dry run validates without touching the database (the client is created but never used).
  if (apply) needDb();
  const imp = await importApp("app/lib/calls/import.ts");
  const { prisma } = await importApp("app/lib/db.ts");
  try {
    for (const row of selectRows()) {
      const st = loadState(row.key);
      const p = paths(row.key);
      if (!st.merge) { console.log(`${row.key}: not merged yet, skipped`); continue; }
      if (apply && !st.upload) { console.log(`${row.key}: not uploaded yet, skipped (the call would have no audio)`); continue; }
      try {
        const merged = JSON.parse(readFileSync(p.merged, "utf8"));
        const payload = imp.parseImportPayload({
          sessionId: row.key,
          sourceUrl: row.url,
          eventName: row.event_name || row.title || null,
          crewId: row.crew_id || "community_call",
          startedAt: row.started_at_utc || st.probe?.startedAt,
          durationSec: merged.durationSec,
          language: "english",
          mix: st.upload ? { key: st.upload.mixKey, bytes: st.upload.mixBytes } : null,
          segments: merged.segments,
          speakers: merged.speakers,
          importedBy: process.env.IMPORT_OPERATOR_DISCORD_ID || null,
          importMeta: {
            engine: "whisper.cpp+pyannote",
            whisper: { model: st.transcribe?.model, vad: st.transcribe?.vadModel, flags: st.transcribe?.flags },
            diarization: st.diarize?.engine,
            sha256: { ...st.fetch?.sha256, whisper: st.transcribe?.sha256, rttm: st.diarize?.sha256 },
            stats: st.merge.stats,
            tool: "x-import",
          },
        });
        if (!apply) { console.log(`${row.key}: valid, ${payload.segments.length} lines, ${payload.speakers.length} speaker(s); would import`); continue; }
        const out = await imp.importExternalRecording(payload, { force });
        if (out.action !== "refused") { st.import = { at: new Date().toISOString(), id: out.id, action: out.action }; delete st.error; }
        console.log(`${row.key}: ${out.action}${out.reason ? ` (${out.reason})` : ""}`);
      } catch (e) {
        st.error = { step: "import", message: cleanErr(e) };
        console.error(`${row.key}: import failed: ${st.error.message}`);
      }
      saveState(st);
    }
  } finally {
    await prisma.$disconnect?.();
  }
}

async function summarizeStep() {
  needDb();
  if (!process.env.AI_GATEWAY_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) die("summarize needs AI_GATEWAY_API_KEY (or OPENAI_API_KEY) in the environment");
  const imp = await importApp("app/lib/calls/import.ts");
  const rec = await importApp("app/lib/calls/recordings.ts");
  const { prisma } = await importApp("app/lib/db.ts");
  try {
    const limit = numArg("limit", 10);
    const todo = await imp.listImportedNeedingSummary(limit);
    console.log(`${todo.length} imported call(s) need a summary${apply ? "" : " (dry run: re-run with --apply)"}`);
    if (!apply) return;
    for (const r of todo) {
      const result = await rec.generateAndStoreSummaryResult(r.id, { onlyIfEmpty: true, unlessEdited: true, budgetMs: 600_000 });
      console.log(`${r.sessionId}: ${result}`);
    }
  } finally {
    await prisma.$disconnect?.();
  }
}

/** Remove imported calls from the database (a test import, or one to redo). Dry run by default; never a Discord call or a published one. */
async function deleteStep() {
  needDb();
  if (!only || only.size === 0) die("delete needs --only <key,...> (x-broadcast-<id>)");
  const keys = [...only];
  for (const k of keys) if (!/^x-(broadcast|space)-[A-Za-z0-9]{8,32}$/.test(k)) die(`not an import key: ${k}`);
  const { prisma } = await importApp("app/lib/db.ts");
  try {
    for (const key of keys) {
      const rec = await prisma.callRecording.findUnique({ where: { sessionId: key }, select: { id: true, source: true, status: true } });
      if (!rec) { console.log(`${key}: not in the database`); continue; }
      if (rec.source === "DISCORD") { console.log(`${key}: refused, a Discord-recorded call`); continue; }
      if (rec.status === "PUBLISHED") { console.log(`${key}: refused, it is published (unpublish it on /admin/calls first)`); continue; }
      if (!apply) { console.log(`${key}: would delete row ${rec.id} (${rec.status}) with its speakers; R2 objects stay`); continue; }
      await prisma.callRecording.delete({ where: { id: rec.id } });
      const st = loadState(key);
      delete st.import;
      saveState(st);
      console.log(`${key}: deleted row ${rec.id}. Re-run "import --apply" to bring it back.`);
    }
  } finally {
    await prisma.$disconnect?.();
  }
}

function statusStep() {
  const rows = loadManifest();
  console.log("key\tinclude\tstep\terror\trow id");
  for (const row of rows) {
    const st = loadState(row.key);
    const done = ["fetch", "transcribe", "diarize", "merge", "upload", "import"].filter((s) => st[s]).pop() ?? (st.probe ? `probe:${st.probe.status}` : "-");
    console.log([row.key, row.include || "-", st.skip ? `skip:${st.skip}` : done, st.error ? `${st.error.step}: ${st.error.message}` : "", st.import?.id ?? ""].join("\t"));
  }
}

const STEP_FNS = { fetch: fetchStep, transcribe: transcribeStep, diarize: diarizeStep, merge: mergeStep, upload: uploadStep, import: importStep, summarize: summarizeStep };
const ORDER = ["fetch", "transcribe", "diarize", "merge", "upload", "import", "summarize"];

console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (writes nothing; re-run with --apply)");
switch (cmd) {
  case "discover": await discover(); break;
  case "probe": await probe(); break;
  case "status": statusStep(); break;
  case "delete": await deleteStep(); break;
  case "run": {
    const from = ORDER.indexOf(String(args.from ?? "fetch"));
    const to = ORDER.indexOf(String(args.to ?? "import"));
    if (from < 0 || to < 0 || from > to) die(`--from/--to must be steps in this order: ${ORDER.join(", ")}`);
    for (const s of ORDER.slice(from, to + 1)) {
      console.log(`\n== ${s}`);
      await STEP_FNS[s]();
    }
    break;
  }
  default:
    if (!STEP_FNS[cmd]) die(`unknown step "${cmd}". Steps: discover, probe, ${ORDER.join(", ")}, status, run`);
    await STEP_FNS[cmd]();
}
