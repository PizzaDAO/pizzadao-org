// app/lib/i18n/get-locale.ts
// Server-only locale resolver. Order:
//   1. NEXT_LOCALE cookie (already-pinned preference)
//   2. Accept-Language header (best-effort match against supported set)
//   3. DEFAULT_LOCALE
//
// We intentionally do NOT read MemberProfileExtras here — that read happens
// in the POST /api/profile-extras handler, which then sets the cookie. Doing
// the DB lookup on every request would balloon the cold-start budget.

import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  isSupportedLocale,
} from "./locales";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export async function resolveLocale(): Promise<SupportedLocale> {
  // 1. Cookie
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isSupportedLocale(cookieValue)) return cookieValue;
  } catch {
    // cookies() can throw outside a request scope — fall through
  }

  // 2. Accept-Language
  try {
    const headerStore = await headers();
    const accept = headerStore.get("accept-language");
    if (accept) {
      const matched = matchAcceptLanguage(accept);
      if (matched) return matched;
    }
  } catch {
    // headers() can throw outside a request scope — fall through
  }

  // 3. Default
  return DEFAULT_LOCALE;
}

function matchAcceptLanguage(header: string): SupportedLocale | null {
  // Parse "en-US,en;q=0.9,es;q=0.8" → ordered list of base language codes
  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";");
      const q = qPart?.startsWith("q=") ? parseFloat(qPart.slice(2)) : 1;
      const base = tag?.split("-")[0]?.toLowerCase() ?? "";
      return { base, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((c) => c.base)
    .sort((a, b) => b.q - a.q);

  for (const { base } of candidates) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base as SupportedLocale;
    }
  }
  return null;
}
