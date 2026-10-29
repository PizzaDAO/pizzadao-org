"use client";

// "How to do this": a link from a mission card to the handbook page that explains it.
// The href is an internal path validated server-side (app/lib/guide-href.ts).

import Link from "next/link";
import { useTranslations } from "next-intl";

export function GuideLink({ href, muted = false }: { href: string; muted?: boolean }) {
  const t = useTranslations("missionLinks");
  return (
    <div data-testid="mission-guide-link" style={{ marginTop: 8, fontSize: 13, opacity: muted ? 0.7 : 1 }}>
      <Link href={href} style={{ fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
        {t("howTo")}
      </Link>
    </div>
  );
}

/** "How levels work" under the missions masthead. */
export function HowLevelsWorkLink() {
  const t = useTranslations("missionLinks");
  return (
    <Link href="/handbook/levels" style={{ fontSize: 14, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
      {t("howLevelsWork")}
    </Link>
  );
}
