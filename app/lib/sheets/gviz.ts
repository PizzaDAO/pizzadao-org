/**
 * One way to read a Google Sheet through the public GViz endpoint.
 *
 *   fetchGviz(SHEET_IDS.members, { tab: "Crew", headers: 0 }, { revalidate: 120, tags: ["members"] })
 *
 * Caching goes through Next's data cache (`fetch(..., { next: { revalidate, tags } })`)
 * so it is shared across serverless instances and can be invalidated with
 * `revalidateTag`. Pass `{ fresh: true }` for reads that must hit Google
 * directly (e.g. an ownership check right before a write).
 */

import { parseGvizJson, type GvizResponse } from "@/app/lib/gviz-parser";

export interface GvizQuery {
  /** Tab name (`sheet=`). Omit for the first tab. */
  tab?: string;
  /** Tab gid (`gid=`), alternative to `tab`. */
  gid?: string | number;
  /** GViz query language string (`tq=`), e.g. "select A, B where C = 'x'". */
  query?: string;
  /**
   * Number of header rows GViz should treat as labels (`headers=`).
   * `0` keeps every row in `table.rows` (what most of our parsers expect).
   * Omit to let GViz guess.
   */
  headers?: number;
}

export interface GvizCacheOptions {
  /** Bypass every cache layer (`cache: "no-store"`). Takes precedence over `revalidate`. */
  fresh?: boolean;
  /** Seconds before the cached response is revalidated. */
  revalidate?: number;
  /** Cache tags for `revalidateTag`. */
  tags?: string[];
  /** Extra request headers (e.g. a User-Agent). */
  headers?: HeadersInit;
}

export class GvizFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "GvizFetchError";
  }
}

/** Build the GViz JSON URL for a sheet. */
export function buildGvizUrl(sheetId: string, q: GvizQuery = {}): string {
  if (!sheetId) throw new Error("buildGvizUrl: sheetId is required");
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:json");
  if (q.tab) url.searchParams.set("sheet", q.tab);
  if (q.gid !== undefined && q.gid !== "") url.searchParams.set("gid", String(q.gid));
  if (q.query) url.searchParams.set("tq", q.query);
  if (q.headers !== undefined) url.searchParams.set("headers", String(q.headers));
  return url.toString();
}

/** Translate cache options into the `fetch` init Next understands. */
export function gvizFetchInit(opts: GvizCacheOptions = {}): RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
} {
  const init: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {};
  if (opts.headers) init.headers = opts.headers;

  if (opts.fresh || opts.revalidate === undefined) {
    // No explicit cache policy means "don't cache": the safe default.
    init.cache = "no-store";
    return init;
  }

  init.next = { revalidate: opts.revalidate };
  if (opts.tags?.length) init.next.tags = opts.tags;
  return init;
}

/**
 * Fetch the raw GViz response body. Throws `GvizFetchError` on a non-2xx
 * status or when Google answers with an HTML page (sheet not shared / deleted).
 */
export async function fetchGvizText(
  sheetId: string,
  q: GvizQuery = {},
  opts: GvizCacheOptions = {},
): Promise<string> {
  const url = buildGvizUrl(sheetId, q);
  const res = await fetch(url, gvizFetchInit(opts));
  const text = await res.text();

  if (!res.ok) {
    throw new GvizFetchError(`GViz fetch failed: ${res.status}`, res.status, url);
  }

  const head = text.slice(0, 512).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) {
    throw new GvizFetchError(
      "GViz returned HTML (not JSON). The sheet/tab may not be shared or may not exist.",
      res.status,
      url,
    );
  }

  return text;
}

/** Fetch a sheet through GViz and parse it with the shared gviz-parser. */
export async function fetchGviz(
  sheetId: string,
  q: GvizQuery = {},
  opts: GvizCacheOptions = {},
): Promise<GvizResponse> {
  return parseGvizJson(await fetchGvizText(sheetId, q, opts));
}
