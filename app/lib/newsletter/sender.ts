// app/lib/newsletter/sender.ts
//
// The newsletter sender identity comes from admin settings only (newsletter.fromName,
// newsletter.fromAddress, newsletter.replyTo). There is deliberately no built-in default address:
// with none saved, no newsletter email is sent.
import type { Settings } from "@/app/lib/settings";

export interface NewsletterSender {
  from: string;
  replyTo?: string;
}

/** RFC 5322: a display name with specials is a quoted-string (escape \\ and "). */
export function displayName(name: string): string {
  return /^[A-Za-z0-9 ._'-]+$/.test(name) ? name : `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

export function newsletterSender(settings: Settings): NewsletterSender | null {
  if (settings.readFailed || settings.invalidKeys.includes("newsletter.fromAddress")) return null;
  const address = String(settings.get("newsletter.fromAddress") ?? "").trim();
  if (!address) return null;
  const name = String(settings.get("newsletter.fromName") ?? "").replace(/[<>"\r\n]/g, "").trim();
  const replyTo = String(settings.get("newsletter.replyTo") ?? "").trim();
  return { from: name ? `${displayName(name)} <${address}>` : address, ...(replyTo ? { replyTo } : {}) };
}
