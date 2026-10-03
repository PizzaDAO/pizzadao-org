/**
 * Post a Discord message (bot channel message or webhook) with rate-limit
 * handling.
 *
 * - 429 with a JSON `retry_after` (or a Retry-After header) is waited out and
 *   retried, as long as the wait is short (a 429 means nothing was posted, so a
 *   retry cannot double-post).
 * - A Cloudflare edge block (HTML 429 / "error code: 1015") is NOT retried:
 *   retrying only extends the block.
 * - Other non-2xx responses are not retried (a 5xx may still have posted).
 *
 * Server-side only.
 */

export type DiscordTarget =
  | { kind: "bot"; channelId: string; botToken: string }
  | { kind: "webhook"; url: string };

export interface DiscordMessageBody {
  content: string;
  /** Rich embeds (e.g. the Pepperoni Bot style from discord-interactions/embeds.ts). */
  embeds?: unknown[];
  allowed_mentions?: { parse?: Array<"everyone" | "roles" | "users">; users?: string[] };
  flags?: number;
}

export interface DiscordPostOptions {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Longest single rate-limit wait we are willing to sleep (default 15s). */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export class DiscordPostError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
    readonly cloudflare = false,
  ) {
    super(message);
    this.name = "DiscordPostError";
  }
}

export const DISCORD_MESSAGE_LIMIT = 2000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function describeTarget(target: DiscordTarget): string {
  return target.kind === "bot" ? `channel ${target.channelId}` : "webhook";
}

function buildRequest(target: DiscordTarget, body: DiscordMessageBody): { url: string; init: RequestInit } {
  if (target.kind === "bot") {
    return {
      url: `https://discord.com/api/v10/channels/${target.channelId}/messages`,
      init: {
        method: "POST",
        headers: { Authorization: `Bot ${target.botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    };
  }
  const u = new URL(target.url);
  u.searchParams.set("wait", "true");
  return {
    url: u.toString(),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  };
}

/** Parse the wait (ms) from a Discord 429. Null when it is a Cloudflare block. */
export function parseRateLimit(
  headers: Headers,
  bodyText: string,
): { retryAfterMs: number | null; cloudflare: boolean } {
  let json: { retry_after?: number } | null = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  if (json && typeof json.retry_after === "number") {
    return { retryAfterMs: Math.ceil(json.retry_after * 1000), cloudflare: false };
  }
  const header = headers.get("retry-after");
  const looksCloudflare =
    /error code:\s*1015/i.test(bodyText) ||
    /cloudflare/i.test(bodyText) ||
    (headers.get("content-type") || "").includes("text/html");
  if (looksCloudflare) {
    const secs = header ? Number(header) : NaN;
    return { retryAfterMs: Number.isFinite(secs) ? secs * 1000 : null, cloudflare: true };
  }
  if (header && Number.isFinite(Number(header))) {
    return { retryAfterMs: Number(header) * 1000, cloudflare: false };
  }
  return { retryAfterMs: null, cloudflare: false };
}

/** Post a message. Resolves with the created message id (when Discord returns one). */
export async function postDiscordMessage(
  target: DiscordTarget,
  body: DiscordMessageBody,
  opts: DiscordPostOptions = {},
): Promise<{ id: string | null }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const maxWaitMs = opts.maxWaitMs ?? 15_000;
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetchImpl ?? fetch;

  if (body.content.length > DISCORD_MESSAGE_LIMIT) {
    throw new DiscordPostError(
      `Message is ${body.content.length} characters; Discord's limit is ${DISCORD_MESSAGE_LIMIT}.`,
      400,
    );
  }

  const { url, init } = buildRequest(target, body);
  const where = describeTarget(target);

  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(url, init);
    const text = await res.text();

    if (res.ok) {
      try {
        const json = JSON.parse(text) as { id?: string };
        return { id: json.id ?? null };
      } catch {
        return { id: null };
      }
    }

    if (res.status === 429) {
      const { retryAfterMs, cloudflare } = parseRateLimit(res.headers, text);
      if (cloudflare) {
        throw new DiscordPostError(
          `Discord's Cloudflare edge is rate-limiting this server (429/1015) posting to ${where}. Wait a few minutes before retrying.`,
          429,
          retryAfterMs,
          true,
        );
      }
      const wait = retryAfterMs ?? 1000;
      if (attempt < maxAttempts && wait <= maxWaitMs) {
        await sleep(wait + 250);
        continue;
      }
      throw new DiscordPostError(
        `Discord rate limit posting to ${where}: retry after ${Math.ceil(wait / 1000)}s.`,
        429,
        wait,
      );
    }

    let detail = text.slice(0, 300);
    try {
      const json = JSON.parse(text) as { message?: string; code?: number };
      if (json.message) detail = `${json.message}${json.code ? ` (code ${json.code})` : ""}`;
    } catch {
      /* keep raw text */
    }
    throw new DiscordPostError(`Discord API error ${res.status} posting to ${where}: ${detail}`, res.status);
  }
}
