"use client";

// app/ui/profile/EventsAttendedLazy.tsx
//
// "Events attended" on the profile (plans/profile-events-attended.md). Same lazy pattern as
// CollectionsLazy: nothing is fetched until the section is within 200px of the viewport, and the data
// comes from stored rows (the API never calls rsv.pizza). Renders nothing while the feature is off, and
// nothing for visitors when the list is empty; the owner then sees the prompt to verify an email.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

type Badge = "attended" | "ticket" | "organizer";

interface EventRow {
    id: string;
    name: string;
    date: string | null;
    year: number | null;
    city: string | null;
    url: string | null;
    badge: Badge;
}

interface Payload {
    enabled: boolean;
    isOwner?: boolean;
    events: EventRow[];
    total: number;
    visibility?: "public" | "members" | "private";
    emailState?: "none" | "unverified" | "verified";
    link?: { available: boolean; linked: boolean };
}

const FIRST = 6;

/**
 * `isOwner` (the profile page knows the viewer from the session) picks the endpoint: the owner reads the
 * no-store /me view, everyone else the shared, cacheable visitor view. The two bodies are never mixed.
 */
export function EventsAttendedLazy({ memberId, isOwner = false }: { memberId: string; isOwner?: boolean }) {
    const t = useTranslations("eventsAttended");
    const locale = useLocale();
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [inView, setInView] = useState(false);
    const [data, setData] = useState<Payload | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (inView) return;
        const el = wrapperRef.current;
        if (!el || typeof IntersectionObserver === "undefined") {
            setInView(true);
            return;
        }
        const obs = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setInView(true);
                    obs.disconnect();
                }
            },
            { rootMargin: "200px" },
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [inView]);

    const load = useCallback(async () => {
        try {
            const r = await fetch(isOwner ? "/api/events-attended/me" : `/api/events-attended/${encodeURIComponent(memberId)}`);
            setData(r.ok ? ((await r.json()) as Payload) : null);
        } catch {
            setData(null);
        }
    }, [memberId, isOwner]);

    useEffect(() => {
        if (!inView) return;
        setData(null); // never show one view's body under the other's controls
        void load();
        const q = new URLSearchParams(window.location.search).get("rsv");
        if (q === "linked") setNote(t("linkedNote"));
        else if (q === "failed") setNote(t("linkFailed"));
    }, [inView, load, t]);

    async function unlink() {
        setBusy(true);
        try {
            await fetch("/api/events-attended/link", { method: "DELETE" });
            await load();
        } finally {
            setBusy(false);
        }
    }

    async function setVisibility(visibility: string) {
        setBusy(true);
        try {
            await fetch("/api/events-attended/visibility", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visibility }),
            });
            await load();
        } finally {
            setBusy(false);
        }
    }

    // Before the data arrives (or when disabled) only an empty sentinel exists, so there is no layout shift.
    if (!data || !data.enabled) return <div ref={wrapperRef} aria-hidden />;
    const owner = data.isOwner === true;
    if (!owner && data.events.length === 0) return <div ref={wrapperRef} aria-hidden />;

    const shown = expanded ? data.events : data.events.slice(0, FIRST);
    const when = (e: EventRow) => {
        if (e.date) return new Date(e.date).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
        return e.year ? String(e.year) : null;
    };

    return (
        <section
            ref={wrapperRef}
            className="paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <p className="overline text-tomato mb-3">{t("overline")}</p>
            <h2 className="m-0 mb-3 text-lg font-semibold">{t("title")}</h2>

            {owner && data.emailState === "none" ? (
                <p className="mb-3 text-sm" data-testid="prompt-email-none">
                    {t("promptNone")}{" "}
                    <Link href={`/profile/${encodeURIComponent(memberId)}/edit#email`} className="underline">
                        {t("promptNoneLink")}
                    </Link>
                    <span className="block text-muted-foreground">{t("emailOnlyUsedFor")}</span>
                </p>
            ) : null}
            {owner && data.emailState === "unverified" ? (
                <p className="mb-3 text-sm" data-testid="prompt-email-unverified">
                    {t("promptUnverified")}{" "}
                    <Link href={`/profile/${encodeURIComponent(memberId)}/edit#email`} className="underline">
                        {t("promptUnverifiedLink")}
                    </Link>
                    <span className="block text-muted-foreground">{t("emailOnlyUsedFor")}</span>
                </p>
            ) : null}

            {data.events.length > 0 ? (
                <ul className="m-0 grid list-none gap-2 p-0">
                    {shown.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm" style={{ borderColor: "hsl(var(--rule-warm) / 0.35)" }}>
                            <span>
                                {e.url ? (
                                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                                        {e.name}
                                    </a>
                                ) : (
                                    <span className="font-medium">{e.name}</span>
                                )}
                                <span className="text-muted-foreground">{[e.city, when(e)].filter(Boolean).map((x) => ` · ${x}`).join("")}</span>
                            </span>
                            <span className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs">{t(`badge.${e.badge}`)}</span>
                        </li>
                    ))}
                </ul>
            ) : owner ? (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : null}

            {data.events.length > FIRST && !expanded ? (
                <button type="button" className="mt-3 text-sm underline" onClick={() => setExpanded(true)}>
                    {t("showAll", { count: data.total })}
                </button>
            ) : null}

            {owner ? (
                <div className="mt-4 grid gap-2 border-t pt-3 text-sm" style={{ borderColor: "hsl(var(--rule-warm) / 0.35)" }}>
                    {data.link?.linked ? (
                        <p className="m-0 flex flex-wrap items-center gap-3" data-testid="rsv-linked">
                            <span>{t("linked")}</span>
                            <button type="button" className="underline" disabled={busy} onClick={() => void unlink()}>
                                {t("unlink")}
                            </button>
                        </p>
                    ) : data.link?.available ? (
                        <p className="m-0">
                            {/* An API redirect, not a page: a plain anchor (no prefetch) is right. */}
                            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                            <a href="/api/events-attended/link/start" className="btn-pill" data-testid="rsv-link-start">
                                {t("linkButton")}
                            </a>
                        </p>
                    ) : null}
                    <label className="flex flex-wrap items-center gap-2">
                        {t("visibilityLabel")}
                        <select
                            value={data.visibility ?? "public"}
                            disabled={busy}
                            onChange={(e) => void setVisibility(e.target.value)}
                            className="rounded border px-2 py-1"
                        >
                            <option value="public">{t("visibility.public")}</option>
                            <option value="members">{t("visibility.members")}</option>
                            <option value="private">{t("visibility.private")}</option>
                        </select>
                    </label>
                    {note ? <p role="status" className="m-0 text-muted-foreground">{note}</p> : null}
                </div>
            ) : null}
        </section>
    );
}
