// app/lib/reengage/render.ts
//
// Digest -> subject / HTML / plain text, in the member's locale (messages/<locale>.json,
// namespace "reengage"). Pure: no env reads except through the injected options.
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import type { SupportedLocale } from "@/app/lib/i18n/locales";
import type { Digest } from "./digest";

const CATALOGS = { en, es, fr } as const;

export interface RenderOptions {
  siteUrl: string;
  /** Visible unsubscribe page; omitted when links can't be signed (no SESSION_SECRET). */
  unsubscribeUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function translator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: CATALOGS[locale] as unknown as Record<string, unknown>,
    namespace: "reengage",
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;
}

export function formatCallTime(at: Date, locale: SupportedLocale, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(at);
  }
}

export function renderDigestEmail(d: Digest, opts: RenderOptions): RenderedEmail {
  const t = translator(d.locale);
  const name = d.name || "";
  const site = opts.siteUrl.replace(/\/$/, "");
  const missionsUrl = `${site}/missions`;
  const profileEditUrl = `${site}/profile/${encodeURIComponent(d.memberId)}/edit`;

  const subject = d.nextMission
    ? t("subjectMission", { title: d.nextMission.title })
    : t("subjectDefault");

  // Sections as plain data, rendered twice (text + html).
  const lines: { kind: "p" | "h"; text: string }[] = [];
  const greeting = name ? t("greeting", { name }) : t("greeting", { name: "" }).replace(/\s+,/, ",");
  lines.push({ kind: "p", text: greeting }, { kind: "p", text: t("intro") });

  if (d.nextMission) {
    lines.push(
      { kind: "h", text: t("missionHeading") },
      { kind: "p", text: t("missionBody", { level: d.nextMission.level, title: d.nextMission.title }) },
    );
  }
  if (d.allDone) {
    lines.push({ kind: "p", text: t("allCaught") });
  } else if (d.nextLevel && d.remaining > 0) {
    lines.push({
      kind: "p",
      text: d.nextLevelTitle
        ? t("levelProgressTitled", { remaining: d.remaining, nextLevel: d.nextLevel, levelTitle: d.nextLevelTitle })
        : t("levelProgress", { remaining: d.remaining, nextLevel: d.nextLevel }),
    });
  }
  if (d.calls.length > 0) {
    lines.push({ kind: "h", text: t("callsHeading") });
    for (const c of d.calls) {
      lines.push({ kind: "p", text: t("callLine", { crew: c.crew, when: formatCallTime(c.at, d.locale, d.timezone) }) });
    }
  }

  const cta = d.nextMission ? t("missionCta") : t("openApp");
  const ctaUrl = d.nextMission ? missionsUrl : site;

  const text = [
    ...lines.map((l) => (l.kind === "h" ? `\n${l.text.toUpperCase()}` : l.text)),
    "",
    `${cta}: ${ctaUrl}`,
    "",
    "--",
    t("footerWhy"),
    `${t("manage")}: ${profileEditUrl}`,
    ...(opts.unsubscribeUrl ? [`${t("unsubscribe")}: ${opts.unsubscribeUrl}`] : []),
  ].join("\n\n").replace(/\n{3,}/g, "\n\n");

  const body = lines
    .map((l) =>
      l.kind === "h"
        ? `<h2 style="margin:24px 0 6px;font-size:16px;color:#c0392b;text-transform:uppercase;letter-spacing:.04em">${esc(l.text)}</h2>`
        : `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${esc(l.text)}</p>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="${d.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f1e7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1a16">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(t("preheader"))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td>
${body}
<p style="margin:24px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${esc(cta)}</a></p>
<hr style="border:none;border-top:1px solid #e6dfd0;margin:24px 0 12px">
<p style="margin:0 0 6px;font-size:12px;color:#6b6358">${esc(t("footerWhy"))}</p>
<p style="margin:0;font-size:12px;color:#6b6358"><a href="${esc(profileEditUrl)}" style="color:#6b6358">${esc(t("manage"))}</a>${
    opts.unsubscribeUrl
      ? ` &middot; <a href="${esc(opts.unsubscribeUrl)}" style="color:#6b6358">${esc(t("unsubscribe"))}</a>`
      : ""
  }</p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}
