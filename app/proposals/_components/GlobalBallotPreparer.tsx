"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { loadBallot, prepareBallot, shareVoteCode } from "@/app/lib/proposals/client";

type Ready = { id: string; title: string };

const CHECKED_KEY = "pizzadao:proposals-checked";
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Mounted once in the root layout. On any page, for a signed-in member, on devices
 * with a mouse or trackpad, quietly prepares a ballot token for each open proposal the member can vote on, so the token
 * request happens long before any vote. On phones (coarse pointer) nothing is prepared here: a token made where the
 * member cannot easily save it is at risk, so the proposal page prepares it and shows the save prompt right away.
 * Renders a small card with a Save prompt for each ballot it just prepared; nothing otherwise.
 */
export function GlobalBallotPreparer() {
    const t = useTranslations("proposals.banner");
    const [ready, setReady] = useState<Ready[]>([]);
    const [note, setNote] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const last = Number(sessionStorage.getItem(CHECKED_KEY) || 0);
                if (Date.now() - last < CHECK_EVERY_MS) return;
                sessionStorage.setItem(CHECKED_KEY, String(Date.now()));
            } catch {
                /* no sessionStorage: check every time */
            }
            if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) return;
            const r = await fetch("/api/proposals/mine", { cache: "no-store" }).catch(() => null);
            if (!r?.ok) return;
            const { proposals } = (await r.json()) as { proposals: Array<{ id: string; title: string; tokenIssued: boolean }> };
            for (const p of proposals) {
                if (cancelled) return;
                if (p.tokenIssued || loadBallot(p.id)) continue;
                try {
                    if (await prepareBallot(p.id)) setReady((s) => [...s, { id: p.id, title: p.title }]);
                } catch {
                    /* the proposal page shows its own retry message */
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (ready.length === 0) return null;
    return (
        <div className="fixed bottom-4 left-4 right-4 z-50 grid gap-2 sm:right-auto sm:max-w-sm" role="region" aria-label={t("region")}>
            {ready.map((r) => (
                <div key={r.id} className="grid gap-2 rounded border border-[hsl(var(--tomato)/0.5)] bg-card p-3 text-sm shadow">
                    <p className="m-0 font-semibold">{t("ready", { title: r.title })}</p>
                    <p className="m-0">{t("save")}</p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="min-h-11 rounded bg-foreground px-4 text-background"
                            onClick={async () => {
                                const b = loadBallot(r.id);
                                if (!b) return;
                                const how = await shareVoteCode(b, r.title);
                                setNote(how === "failed" ? t("failed") : how === "copied" ? t("copied") : t("shared"));
                            }}
                        >
                            {t("saveCode")}
                        </button>
                        <Link href={`/proposals/${r.id}`} className="inline-flex min-h-11 items-center rounded border px-4 no-underline text-foreground">
                            {t("open")}
                        </Link>
                        <button type="button" className="min-h-11 rounded px-3 underline" onClick={() => setReady((s) => s.filter((x) => x.id !== r.id))}>
                            {t("dismiss")}
                        </button>
                    </div>
                    {note && (
                        <p role="status" className="m-0">
                            {note}
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}
