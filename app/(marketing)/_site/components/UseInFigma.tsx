"use client";

import { ArrowUpRight } from "lucide-react";
import { track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";

interface UseInFigmaProps {
  href: string;
  /** Override label, defaults to "Open in Figma" */
  label?: string;
  /** Light pill on dark bg, or dark pill on light bg */
  tone?: "light" | "dark";
  /** Optional source identifier for analytics (e.g. section name) */
  source?: string;
}

/**
 * Small secondary pill CTA, intended for the top-right of section headers.
 * Links out to prebuilt Figma assets / templates. Fires `sales.figma_kit_opened`.
 */
const UseInFigma = ({ href, label = "Open in Figma", tone = "light", source }: UseInFigmaProps) => {
  const styles =
    tone === "light"
      ? "bg-cream/0 text-ink ring-ink/20 hover:bg-ink hover:text-cream hover:ring-ink"
      : "bg-cream/0 text-cream ring-cream/30 hover:bg-cream hover:text-ink hover:ring-cream";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => track(EVT.FIGMA_OPENED, { href, label, source: source ?? "brand_system" })}
      className={`ui inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] ring-1 ring-inset transition-colors ${styles}`}
    >
      {label}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
};

export default UseInFigma;
