"use client";

import { useTranslations } from "next-intl";

export function TermExplanation({ term }: { term: "missions" | "pep" | "poaps" }) {
  const t = useTranslations("communityTerms");
  return <p className="my-4 text-base leading-relaxed text-foreground/80">{t(term)}</p>;
}
