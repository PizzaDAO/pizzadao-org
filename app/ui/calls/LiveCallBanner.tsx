"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** How often the banner re-checks (the endpoint is CDN cached for ~10 s). */
export const BANNER_POLL_MS = 30_000;

/**
 * "Live now" banner for /calls and the dashboard: asks the public endpoint (title only, no names)
 * and links to /calls/live while a call is live. Renders nothing otherwise, on any failure, and
 * while the tab is hidden it does not poll.
 */
export default function LiveCallBanner({ className = "" }: { className?: string }) {
    const t = useTranslations("callsPage.live");
    const [title, setTitle] = useState<string | null>(null);
    const [live, setLive] = useState(false);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const check = async () => {
            if (stopped) return;
            if (!document.hidden) {
                try {
                    const res = await fetch("/api/calls/live/public");
                    const data = res.ok ? ((await res.json()) as { live: { title: string | null; crewLabel: string | null } | null }) : null;
                    if (!stopped) {
                        setLive(!!data?.live);
                        setTitle(data?.live ? data.live.title || data.live.crewLabel : null);
                    }
                } catch {
                    if (!stopped) setLive(false);
                }
            }
            if (!stopped) timer = setTimeout(check, BANNER_POLL_MS);
        };
        void check();
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    if (!live) return null;
    return (
        <Link
            href="/calls/live"
            data-testid="live-call-banner"
            className={`flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[var(--radius)] bg-tomato-deep px-4 py-3 text-cream no-underline ${className}`}
        >
            <span className="flex min-w-0 items-center gap-2 font-semibold">
                <span aria-hidden className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-cream" />
                <span className="min-w-0 break-words">{t("banner", { title: title ?? t("untitled") })}</span>
            </span>
            <span className="text-sm underline underline-offset-4">{t("bannerCta")}</span>
        </Link>
    );
}
