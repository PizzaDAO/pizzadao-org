// Validation and the team email for the marketing pages' forms (the newsletter signup and the
// contact / partnership message). Pure functions: the routes in app/api/public do the storage.
//
// The limits match the old hosted functions, so the existing forms keep working unchanged.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export interface NewsletterInput {
  email: string;
  source: string;
}

export function parseNewsletter(body: unknown): Parsed<NewsletterInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const email = str(b.email).toLowerCase();
  const source = str(b.source).slice(0, 64) || "journal";
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return { ok: false, error: "Invalid email" };
  return { ok: true, value: { email, source } };
}

export interface ContactInput {
  name: string;
  organization: string | null;
  email: string;
  message: string;
  intents: string[];
}

export function parseContact(body: unknown): Parsed<ContactInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = str(b.name);
  const organization = str(b.organization);
  const email = str(b.email);
  const message = str(b.message);
  const intents = Array.isArray(b.intents)
    ? b.intents.filter((i): i is string => typeof i === "string").map((i) => i.trim().slice(0, 80)).filter(Boolean).slice(0, 12)
    : [];
  if (!name || name.length > 200) return { ok: false, error: "Invalid name" };
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return { ok: false, error: "Invalid email" };
  if (!message || message.length > 5000) return { ok: false, error: "Invalid message" };
  if (organization.length > 200) return { ok: false, error: "Invalid organization" };
  return { ok: true, value: { name, organization: organization || null, email, message, intents } };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The notification the team gets for a stored message. */
export function contactEmail(id: string, c: ContactInput): { subject: string; html: string; text: string } {
  const tagsHtml = c.intents.length
    ? `<p style="margin:0 0 16px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#9b6b00">${c.intents.map(escapeHtml).join(" &nbsp;·&nbsp; ")}</p>`
    : "";
  const html = `
    <div style="font-family:Georgia,serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
      ${tagsHtml}
      <h1 style="font-size:22px;margin:0 0 16px">New note from ${escapeHtml(c.name)}</h1>
      <table style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;border-collapse:collapse;margin:0 0 20px">
        <tr><td style="padding:4px 12px 4px 0;color:#888">Name</td><td>${escapeHtml(c.name)}</td></tr>
        ${c.organization ? `<tr><td style="padding:4px 12px 4px 0;color:#888">Organization</td><td>${escapeHtml(c.organization)}</td></tr>` : ""}
        <tr><td style="padding:4px 12px 4px 0;color:#888">Email</td><td><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td></tr>
      </table>
      <div style="font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#1a1a1a;white-space:pre-wrap;border-left:3px solid #F83A3A;padding:4px 0 4px 16px">${escapeHtml(c.message)}</div>
      <p style="margin-top:32px;font-size:11px;color:#999">Submission id: ${escapeHtml(id)}</p>
    </div>
  `;
  const text =
    (c.intents.length ? `Tags: ${c.intents.join(", ")}\n\n` : "") +
    `Name: ${c.name}\n` +
    (c.organization ? `Organization: ${c.organization}\n` : "") +
    `Email: ${c.email}\n\n` +
    `Message:\n${c.message}\n`;
  const subject = `New PizzaDAO note from ${c.name}${c.intents.length ? ` (${c.intents[0]})` : ""}`;
  return { subject, html, text };
}
