// app/lib/reengage/mailer.ts
//
// Thin Resend client (plain fetch, no new dependency). The repo had no email
// provider; Resend fits a domain attached to Vercel (email.pizzadao.org) with
// DKIM/SPF set up in the Resend dashboard.
//
// Env: RESEND_API_KEY, REENGAGE_EMAIL_FROM (e.g. "PizzaDAO <hello@email.pizzadao.org>"),
// REENGAGE_POSTAL_ADDRESS (CAN-SPAM; required to send the digest).
// Never logs the recipient or the key. Calls are spaced to stay under Resend's
// 2 requests/second limit and time out after 10 s.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

/** `retryable`: the provider was rate limiting / failing / unreachable, so a later run may succeed. */
export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: string; retryable: boolean; rateLimited?: boolean };

export const DEFAULT_FROM = "PizzaDAO <hello@email.pizzadao.org>";
export const SEND_TIMEOUT_MS = 10_000;

export function fromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.REENGAGE_EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/** The sender's physical postal address required in the footer of marketing mail (CAN-SPAM). */
export function postalAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.REENGAGE_POSTAL_ADDRESS?.trim() || null;
}

/** Header values must be one line. */
export function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

// ---- throttle: at most one request per MIN_INTERVAL_MS (< 2 req/s) ----
let minIntervalMs = 600;
let nextSlot = 0;
export function __setMinInterval(ms: number): void {
  minIntervalMs = ms;
  nextSlot = 0;
}
async function throttle(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + minIntervalMs;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function sendEmail(
  msg: OutgoingEmail,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, reason: "no_api_key", retryable: false };
  await throttle();
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: fromAddress(env),
        to: [msg.to],
        subject: oneLine(msg.subject),
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `http_${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
        rateLimited: res.status === 429,
      };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch {
    // timeout or network error: the send may or may not have gone out, but the
    // Idempotency-Key makes a retry safe.
    return { ok: false, reason: "network", retryable: true };
  }
}
