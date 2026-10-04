// e2e/local/preload.cjs
//
// Loaded with `node --require` (via NODE_OPTIONS) into the seed script and the
// `next dev` server started by `npm run e2e:local`. It makes the app run
// against a throwaway local Postgres and keeps the run read-only towards every
// external service. App code is not modified.
//
//   1. Postgres over the Neon driver. app/lib/db.ts uses @prisma/adapter-neon,
//      which talks Postgres over a WebSocket to `wss://<host>/v2`. We replace
//      globalThis.WebSocket with a tiny shim that, for those URLs, opens a
//      plain TCP socket to the local Postgres (E2E_PG_HOST:E2E_PG_PORT).
//      Postgres must use cleartext "password" auth (the driver pipelines the
//      password), which is how the docker container in run.mjs is configured.
//
//   2. Network guard. Every outbound fetch is checked:
//        * Discord (discord.com / discordapp.com) is blocked outright, so no
//          bot call, role sync or webhook post can leave the machine.
//        * Any non-GET/HEAD request to a non-local host is blocked (Sheets
//          writes, Apps Script web apps, Blob uploads, KV, ...).
//      Blocked calls get a synthetic 503 and are appended to E2E_BLOCKED_LOG.
//
//      Exception: GET guilds/<FAKE_DISCORD_GUILD_ID>/members/<id> for a fixture
//      member is answered locally with that fixture's discordRoles (404 for
//      anyone else), and GET guilds/<FAKE_DISCORD_GUILD_ID>/roles with [], so
//      role checks (e.g. /admin/shop) can be exercised.
//      Nothing is sent to Discord.
//
//   3. Members sheet fixture. MEMBERS_SHEET_ID is set to "e2e-local-members".
//      GViz reads of that ID are served from the real public members sheet
//      (read-only GET) with the synthetic test members from fixtures.cjs
//      appended. If Google is unreachable, only the fixture rows are served.
"use strict";

const net = require("node:net");
const fs = require("node:fs");
const { E2E_MEMBERS_SHEET_ID, REAL_MEMBERS_SHEET_ID, TEST_MEMBER_ROWS, MEMBERS, FAKE_DISCORD_GUILD_ID } = require("./fixtures.cjs");

const PG_HOST = process.env.E2E_PG_HOST || "127.0.0.1";
const PG_PORT = Number(process.env.E2E_PG_PORT || 54329);
const BLOCKED_LOG = process.env.E2E_BLOCKED_LOG || "";

// ---------------------------------------------------------------------------
// 1. WebSocket -> TCP shim for the Neon driver
// ---------------------------------------------------------------------------

const NativeWebSocket = globalThis.WebSocket;

class PgTcpWebSocket {
  constructor(url) {
    this.url = url;
    this.binaryType = "arraybuffer";
    this.readyState = 0;
    this._listeners = { open: [], message: [], close: [], error: [] };
    this._sock = net.connect({ host: PG_HOST, port: PG_PORT });
    this._sock.setNoDelay(true);
    this._sock.on("connect", () => {
      this.readyState = 1;
      this._emit("open", {});
    });
    this._sock.on("data", (buf) => {
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      this._emit("message", { data });
    });
    this._sock.on("error", (err) => this._emit("error", err));
    this._sock.on("close", () => {
      this.readyState = 3;
      this._emit("close", {});
    });
  }
  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
  }
  _emit(type, ev) {
    for (const fn of this._listeners[type] || []) {
      try {
        fn(ev);
      } catch (e) {
        console.error("[e2e-preload] listener error", e);
      }
    }
  }
  send(data) {
    this._sock.write(Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data));
  }
  close() {
    this.readyState = 2;
    this._sock.end();
  }
}

function isNeonDbUrl(url) {
  try {
    const u = new URL(String(url));
    return /^wss?:$/.test(u.protocol) && u.pathname === "/v2" && isLocalHost(u.hostname);
  } catch {
    return false;
  }
}

globalThis.WebSocket = function WebSocket(url, protocols) {
  if (isNeonDbUrl(url)) return new PgTcpWebSocket(url);
  if (!NativeWebSocket) throw new Error("WebSocket unavailable");
  return new NativeWebSocket(url, protocols);
};

// ---------------------------------------------------------------------------
// 2. Network guard + 3. members sheet fixture
// ---------------------------------------------------------------------------

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function logBlocked(method, url, reason) {
  const line = `${new Date().toISOString()} BLOCKED ${method} ${url} (${reason})\n`;
  console.warn(`[e2e-preload] ${line.trim()}`);
  if (BLOCKED_LOG) {
    try {
      fs.appendFileSync(BLOCKED_LOG, line);
    } catch {
      /* ignore */
    }
  }
}

function blockedResponse(reason) {
  return new Response(JSON.stringify({ error: `blocked by e2e:local network guard: ${reason}` }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;

/** Local answer for a guild member lookup: fixture members only, never Discord. */
function fakeGuildMember(discordId) {
  const m = MEMBERS.find((x) => x.discordId === discordId);
  if (!m) {
    return new Response(JSON.stringify({ message: "Unknown Member", code: 10007 }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const body = { nick: m.name, roles: m.discordRoles || [], user: { id: m.discordId, username: m.username } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function parseGvizText(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

function fixtureRowToGviz(values, width) {
  const c = [];
  for (let i = 0; i < width; i++) {
    const v = values[i];
    c.push(v === undefined || v === null || v === "" ? null : { v });
  }
  return { c };
}

async function serveMembersSheet(url, init) {
  const realUrl = new URL(url);
  realUrl.pathname = realUrl.pathname.replace(E2E_MEMBERS_SHEET_ID, REAL_MEMBERS_SHEET_ID);
  let json;
  try {
    const res = await realFetch(realUrl.toString(), { cache: "no-store", headers: init?.headers });
    json = parseGvizText(await res.text());
  } catch (e) {
    console.warn("[e2e-preload] members sheet unreachable, serving fixture rows only:", e?.message);
    json = null;
  }
  if (!json || json.status !== "ok") {
    // Minimal table: header row + fixture rows.
    const header = TEST_MEMBER_ROWS.header;
    json = {
      version: "0.6",
      status: "ok",
      table: { cols: header.map((_, i) => ({ id: String.fromCharCode(65 + i), label: "", type: "string" })), rows: [] },
    };
    json.table.rows.push(fixtureRowToGviz(header, header.length));
  }
  const width = json.table.cols.length;
  for (const row of TEST_MEMBER_ROWS.rows(json.table.rows[0])) {
    json.table.rows.push(fixtureRowToGviz(row, width));
  }
  const body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(json)});`;
  return new Response(body, { status: 200, headers: { "content-type": "application/javascript; charset=utf-8" } });
}

globalThis.fetch = async function guardedFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
  const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  let u;
  try {
    u = new URL(url);
  } catch {
    return realFetch(input, init);
  }
  if (isLocalHost(u.hostname)) return realFetch(input, init);

  if (/(^|\.)discord(app)?\.com$/.test(u.hostname)) {
    const fake = method === "GET" && u.pathname.match(/^\/api\/v10\/guilds\/([^/]+)\/members\/(\d+)$/);
    if (fake && fake[1] === FAKE_DISCORD_GUILD_ID) return fakeGuildMember(fake[2]);
    // Guild role list (role-name resolution, e.g. "Pepperoni Mafia"): empty, so
    // the app falls back to its pinned role ids.
    if (method === "GET" && u.pathname === `/api/v10/guilds/${FAKE_DISCORD_GUILD_ID}/roles`) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    logBlocked(method, url, "discord");
    return blockedResponse("discord");
  }
  if (method !== "GET" && method !== "HEAD") {
    logBlocked(method, url, "non-GET to external host");
    return blockedResponse("external write");
  }
  if (u.hostname === "docs.google.com" && u.pathname.includes(`/d/${E2E_MEMBERS_SHEET_ID}/`)) {
    return serveMembersSheet(url, init);
  }
  return realFetch(input, init);
};

// Belt and braces for libraries that bypass fetch (googleapis/gaxios may use
// node:https). Block non-GET requests to Google / Discord APIs there too.
for (const modName of ["node:https", "node:http"]) {
  const mod = require(modName);
  const origRequest = mod.request;
  mod.request = function guardedRequest(...args) {
    let opts = args[0] || {};
    if (typeof args[0] === "string" || args[0] instanceof URL) {
      const u = new URL(String(args[0]));
      opts = { hostname: u.hostname, path: u.pathname, ...(args[1] && typeof args[1] === "object" ? args[1] : {}) };
    }
    const host = String(opts.hostname || opts.host || "").replace(/:\d+$/, "");
    const method = String(opts.method || "GET").toUpperCase();
    if (!isLocalHost(host) && (/discord(app)?\.com$/.test(host) || (method !== "GET" && method !== "HEAD" && /googleapis\.com$|google\.com$/.test(host)))) {
      logBlocked(method, `${modName}//${host}${opts.path || ""}`, "node http guard");
      throw new Error(`blocked by e2e:local network guard: ${method} ${host}`);
    }
    return origRequest.apply(this, args);
  };
}
