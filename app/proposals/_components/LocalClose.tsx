"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatProposalTime } from "@/app/lib/proposals/time";

/**
 * "Closes <date time zone>" in the viewer's own time zone. The server cannot know the zone, so it renders UTC (labelled)
 * and the browser swaps in local time as soon as it mounts. Used on the list and the proposal page.
 */
export function LocalClose({ iso, as: Tag = "span", className }: { iso: string; as?: "span" | "p"; className?: string }) {
    const t = useTranslations("proposals");
    const locale = useLocale();
    const [text, setText] = useState(() => formatProposalTime(iso, locale, "UTC"));
    useEffect(() => setText(formatProposalTime(iso, locale)), [iso, locale]);
    return <Tag className={className}>{t("closes", { date: text })}</Tag>;
}
