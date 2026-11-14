// app/lib/newsletter/confirm-mail.ts
//
// The double opt-in email: render + send
// through the existing Resend mailer. The sender identity always comes from admin settings
// (app/lib/newsletter/sender.ts); with none configured nothing is sent.
import { oneLine, postalAddress, sendEmail, type SendResult } from "@/app/lib/reengage/mailer";
import { newsletterConfirmPageUrl, newsletterUnsubPageUrl, newsletterUnsubPostUrl, signNewsletterConfirm } from "./sig";
import type { NewsletterSender } from "./sender";

export type ConfirmKind = "signup";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const COPY: Record<ConfirmKind, { subject: string; intro: string; cta: string; ignore: string }> = {
  signup: {
    subject: "Confirm your PizzaDAO newsletter signup",
    intro: "Someone (hopefully you) asked to get the PizzaDAO newsletter at this address. Confirm to start receiving it.",
    cta: "Confirm my email",
    ignore: "If this wasn't you, ignore this email and you will not be subscribed.",
  },
};

export function renderNewsletterConfirmEmail(
  kind: ConfirmKind,
  confirmUrl: string,
  opts: { unsubscribeUrl?: string | null; postalAddress?: string | null },
): { subject: string; html: string; text: string } {
  const c = COPY[kind];
  const text = [
    c.intro,
    `${c.cta}: ${confirmUrl}`,
    c.ignore,
    ...(opts.unsubscribeUrl ? [`Unsubscribe: ${opts.unsubscribeUrl}`] : []),
    ...(opts.postalAddress ? [opts.postalAddress] : []),
  ].join("\n\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f6f1e7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1a16">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${esc(c.intro)}</p>
<p style="margin:0 0 16px"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${esc(c.cta)}</a></p>
<p style="margin:0;font-size:12px;color:#6b6358">${esc(c.ignore)}</p>${opts.unsubscribeUrl ? `
<p style="margin:8px 0 0;font-size:12px;color:#6b6358"><a href="${esc(opts.unsubscribeUrl)}" style="color:#6b6358">Unsubscribe</a></p>` : ""}${opts.postalAddress ? `
<p style="margin:8px 0 0;font-size:12px;color:#6b6358">${esc(opts.postalAddress)}</p>` : ""}
</div></body></html>`;
  return { subject: oneLine(c.subject), html, text };
}

/** Sign, render and send one confirmation email. Never logs the address. */
export async function sendNewsletterConfirm(
  sub: { id: string; email: string },
  sender: NewsletterSender,
  kind: ConfirmKind,
): Promise<SendResult> {
  const token = signNewsletterConfirm(sub.id, sub.email);
  if (!token) return { ok: false, reason: "no_secret", retryable: false };
  const unsubPage = newsletterUnsubPageUrl(sub.id);
  const unsubPost = newsletterUnsubPostUrl(sub.id);
  const mail = renderNewsletterConfirmEmail(kind, newsletterConfirmPageUrl(sub.id, token), {
    unsubscribeUrl: unsubPage,
    postalAddress: postalAddress(),
  });
  return sendEmail({
    to: sub.email,
    ...mail,
    from: sender.from,
    replyTo: sender.replyTo,
    headers: unsubPost
      ? { "List-Unsubscribe": `<${unsubPost}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
  });
}
