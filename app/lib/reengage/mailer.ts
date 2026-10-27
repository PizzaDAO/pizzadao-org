// app/lib/reengage/mailer.ts
//
// Thin Resend client (plain fetch, no new dependency). The repo had no email
// provider; Resend is the one that fits a domain attached to Vercel
// (email.pizzadao.org) with DKIM/SPF set up in the Resend dashboard.
//
// Env: RESEND_API_KEY, REENGAGE_EMAIL_FROM (e.g. "PizzaDAO <hello@email.pizzadao.org>").
// Never logs the recipient or the key.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string | null } | { ok: false; reason: string };

export const DEFAULT_FROM = "PizzaDAO <hello@email.pizzadao.org>";

export function fromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.REENGAGE_EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export async function sendEmail(
  msg: OutgoingEmail,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, reason: "no_api_key" };
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: fromAddress(env),
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch {
    return { ok: false, reason: "network" };
  }
}
