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

export function newsletterSender(settings: Settings): NewsletterSender | null {
  if (settings.readFailed || settings.invalidKeys.includes("newsletter.fromAddress")) return null;
  const address = String(settings.get("newsletter.fromAddress") ?? "").trim();
  if (!address) return null;
  const name = String(settings.get("newsletter.fromName") ?? "").replace(/[<>"\r\n]/g, "").trim();
  const replyTo = String(settings.get("newsletter.replyTo") ?? "").trim();
  return { from: name ? `${name} <${address}>` : address, ...(replyTo ? { replyTo } : {}) };
}
