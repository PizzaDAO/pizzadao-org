// app/lib/newsletter/render.ts
//
// Email-safe HTML (table layout, inline styles) and a plain-text version of an issue. One function
// serves the admin preview, the test send and, later, the real sender. Everything is escaped and only
// https links and images are emitted. Internal notes (the sponsor notice) are never rendered.
import type { NewsletterSections } from "./sections";

export interface RenderInput {
  subject: string;
  preheader: string;
  sections: NewsletterSections;
}

export interface RenderOptions {
  /** Per-recipient footer parts; absent for previews and test sends. */
  unsubscribeUrl?: string | null;
  viewInBrowserUrl?: string | null;
  postalAddress?: string | null;
  /** Shown as a banner on test sends. */
  testBanner?: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeUrl = (u: string | null | undefined): string => (u && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : "");
const paras = (s: string) => s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const C = { ink: "#1d1a16", muted: "#6b6358", accent: "#c0392b", card: "#ffffff", bg: "#f6f1e7", line: "#eadfcb" };

const h2 = (t: string) => `<h2 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:${C.ink}">${esc(t)}</h2>`;
const p = (t: string, extra = "") => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${C.ink};${extra}">${esc(t)}</p>`;
const a = (url: string, label: string) => {
  const u = safeUrl(url);
  return u ? `<a href="${esc(u)}" style="color:${C.accent};font-weight:700;text-decoration:underline">${esc(label)}</a>` : esc(label);
};
const block = (inner: string) =>
  `<tr><td style="padding:20px 28px;border-top:1px solid ${C.line}">${inner}</td></tr>`;
const li = (t: string) => `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${C.ink}">${esc(t)}</li>`;
const ul = (items: string[]) => (items.length ? `<ul style="margin:0 0 12px;padding-left:20px">${items.map(li).join("")}</ul>` : "");
const img = (url: string, alt: string) => {
  const u = safeUrl(url);
  return u ? `<img src="${esc(u)}" alt="${esc(alt)}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border-radius:12px;margin:0 0 12px">` : "";
};

const eventItem = (e: { name: string; startsAt: string; url: string }) =>
  `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${C.ink}">${a(e.url, e.name)} <span style="color:${C.muted}">(${esc(formatEventTime(e.startsAt))})</span></li>`;

/** "Sat, Nov 28, 18:00 UTC" */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}, ${time} UTC`;
}

export function renderNewsletter(input: RenderInput, opts: RenderOptions = {}): { subject: string; html: string; text: string } {
  const s = input.sections;
  const rows: string[] = [];
  const text: string[] = [];

  if (s.intro.trim()) {
    rows.push(`<tr><td style="padding:20px 28px 4px">${paras(s.intro).map((t) => p(t)).join("")}</td></tr>`);
    text.push(s.intro.trim());
  }

  if (s.xSpace.enabled && s.xSpace.headline.trim()) {
    const x = s.xSpace;
    const url = safeUrl(x.url);
    rows.push(
      block(
        `${h2(x.headline)}${x.detail ? p(x.detail, `color:${C.muted}`) : ""}${url ? `<p style="margin:0">${a(url, "Open the X Space")}</p>` : ""}`,
      ),
    );
    text.push([x.headline, x.detail, url ? `Open the X Space: ${url}` : ""].filter(Boolean).join("\n"));
  }

  if (s.member.enabled && s.member.name.trim()) {
    const m = s.member;
    const links = m.links.map(safeUrl).filter(Boolean);
    rows.push(
      block(
        `${h2(`Member Spotlight: ${m.name}`)}${img(m.photoUrl, m.name)}${m.city ? p(m.city, `color:${C.muted}`) : ""}${paras(m.blurb).map((t) => p(t)).join("")}${links.length ? `<p style="margin:0">${links.map((u) => a(u, u.replace(/^https:\/\//i, ""))).join(" &middot; ")}</p>` : ""}`,
      ),
    );
    text.push([`MEMBER SPOTLIGHT: ${m.name}`, m.city, m.blurb.trim(), ...links].filter(Boolean).join("\n"));
  }

  if (s.city.enabled && s.city.name.trim()) {
    const c = s.city;
    const body = c.blurb.trim() || c.notes.trim();
    rows.push(block(`${h2(`City Spotlight: ${c.name}`)}${paras(body).map((t) => p(t)).join("")}`));
    text.push([`CITY SPOTLIGHT: ${c.name}`, body].filter(Boolean).join("\n"));
  }

  if (s.partner.enabled && s.partner.name.trim()) {
    const pt = s.partner;
    const site = safeUrl(pt.website);
    rows.push(
      block(
        `${h2(`Partner Spotlight: ${pt.name}`)}${img(pt.logoUrl, pt.name)}${paras(pt.blurb).map((t) => p(t)).join("")}${site ? `<p style="margin:0">${a(site, site.replace(/^https:\/\//i, ""))}</p>` : ""}`,
      ),
    );
    text.push([`PARTNER SPOTLIGHT: ${pt.name}`, pt.blurb.trim(), site].filter(Boolean).join("\n"));
  }

  const events = s.events.items.filter((e) => e.included);
  if (s.events.enabled && events.length) {
    rows.push(
      block(
        `${h2("Upcoming events")}${s.events.intro ? p(s.events.intro) : ""}<ul style="margin:0;padding-left:20px">${events.map(eventItem).join("")}</ul>`,
      ),
    );
    text.push(["UPCOMING EVENTS", s.events.intro.trim(), ...events.map((e) => `- ${e.name} (${formatEventTime(e.startsAt)})${safeUrl(e.url) ? ` ${safeUrl(e.url)}` : ""}`)].filter(Boolean).join("\n"));
  }

  const crews = s.calls.crews.filter((c) => c.included);
  if (s.calls.enabled && crews.length) {
    const inner = crews
      .map(
        (c) =>
          `<h3 style="margin:14px 0 6px;font-size:16px;color:${C.ink}">${esc(c.label)}</h3>${c.summary ? p(c.summary) : ""}${c.shipped.length ? `<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.muted}">Finished</p>${ul(c.shipped)}` : ""}${safeUrl(c.url) ? `<p style="margin:0 0 8px;font-size:14px">${a(c.url, "Read the call recap")}</p>` : ""}`,
      )
      .join("");
    rows.push(block(`${h2("What the crews have been up to")}${s.calls.intro ? p(s.calls.intro) : ""}${inner}`));
    text.push(
      [
        "WHAT THE CREWS HAVE BEEN UP TO",
        s.calls.intro.trim(),
        ...crews.map((c) => [c.label.toUpperCase(), c.summary, ...c.shipped.map((x) => `- ${x}`), safeUrl(c.url) ? `Recap: ${safeUrl(c.url)}` : ""].filter(Boolean).join("\n")),
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  const articles = s.articles.items.filter((x) => x.included);
  if (s.articles.enabled && articles.length) {
    const inner = articles
      .map(
        (x) =>
          `${img(x.coverImage, x.title)}<p style="margin:0 0 4px;font-size:16px;font-weight:700">${a(x.url, x.title)}</p>${x.author ? `<p style="margin:0 0 4px;font-size:13px;color:${C.muted}">by ${esc(x.author)}</p>` : ""}${x.excerpt ? p(x.excerpt) : ""}`,
      )
      .join("");
    rows.push(block(`${h2("New articles")}${s.articles.intro ? p(s.articles.intro) : ""}${inner}`));
    text.push(
      ["NEW ARTICLES", s.articles.intro.trim(), ...articles.map((x) => [x.title, x.author ? `by ${x.author}` : "", x.excerpt, safeUrl(x.url)].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n"),
    );
  }

  const footer: string[] = [];
  const footerText: string[] = [];
  const view = safeUrl(opts.viewInBrowserUrl);
  if (view) {
    footer.push(a(view, "View in browser"));
    footerText.push(`View in browser: ${view}`);
  }
  const unsub = safeUrl(opts.unsubscribeUrl);
  if (unsub) {
    footer.push(a(unsub, "Unsubscribe"));
    footerText.push(`Unsubscribe: ${unsub}`);
  }
  footerText.push("You get this because you asked for the PizzaDAO newsletter.");
  if (opts.postalAddress) footerText.push(opts.postalAddress);

  const banner = opts.testBanner ? `<tr><td style="padding:10px 28px;background:#fff3cd;color:#664d03;font-size:13px">${esc(opts.testBanner)}</td></tr>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.bg};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${C.card};border-radius:16px;overflow:hidden">
${banner}<tr><td style="padding:24px 28px 8px"><p style="margin:0;font-size:22px;font-weight:800;color:${C.ink}">${esc(input.subject)}</p></td></tr>
${rows.join("\n")}
<tr><td style="padding:18px 28px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.muted}">${footer.length ? `<p style="margin:0 0 6px">${footer.join(" &middot; ")}</p>` : ""}<p style="margin:0">You get this because you asked for the PizzaDAO newsletter.</p>${opts.postalAddress ? `<p style="margin:6px 0 0">${esc(opts.postalAddress)}</p>` : ""}</td></tr>
</table>
</body></html>`;

  const plain = [opts.testBanner ?? "", input.subject, ...text, footerText.join("\n")].filter(Boolean).join("\n\n");
  return { subject: input.subject.replace(/[\r\n]+/g, " ").trim(), html, text: plain };
}
