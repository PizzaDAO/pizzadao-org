"use client";

// The QR landing: ask for the member's location (a tap, not automatic), then post the check-in.
// Location is optional: without it a valid QR is held for a reviewer.

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InkStamp } from "../../../ui/passport/InkStamp";

type Result =
    | { kind: "approved"; newStamp: boolean; name: string; city: string | null }
    | { kind: "pending"; name: string }
    | { kind: "error"; reason: string }
    | { kind: "login" };

export function CheckInClient({ qr }: { qr: string }) {
    const t = useTranslations("passport");
    const [busy, setBusy] = useState(false);
    const [locating, setLocating] = useState(false);
    const [result, setResult] = useState<Result | null>(null);

    async function post(loc: { lat: number; lng: number; accuracy: number } | null) {
        setBusy(true);
        try {
            const r = await fetch("/api/passport/check-in", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qr, ...(loc ?? {}) }),
            });
            if (r.status === 401) return setResult({ kind: "login" });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) {
                setResult(
                    j.decision === "APPROVED"
                        ? { kind: "approved", newStamp: !!j.newStamp, name: j.pizzeria.name, city: j.pizzeria.city }
                        : { kind: "pending", name: j.pizzeria.name },
                );
            } else {
                setResult({ kind: "error", reason: j.reason ?? "generic" });
            }
        } catch {
            setResult({ kind: "error", reason: "generic" });
        } finally {
            setBusy(false);
            setLocating(false);
        }
    }

    function start(withLocation: boolean) {
        if (!withLocation || !navigator.geolocation) return void post(null);
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (p) => void post({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => void post(null),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
    }

    const known = ["not_allowed", "not_eligible", "bad_qr", "bad_location", "low_accuracy", "too_far", "daily_limit", "not_found"];

    return (
        <main className="min-h-screen bg-background text-foreground px-4 py-10">
            <div className="mx-auto max-w-md text-center">
                <p className="overline text-tomato mb-1">{t("overline")}</p>
                <h1 className="text-3xl mb-4">{t("checkInTitle")}</h1>

                {!result && (
                    <>
                        <p className="text-foreground/70 mb-6">{t("checkInBody")}</p>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => start(true)}
                            className="btn-pill px-6 py-3 rounded-full bg-tomato text-white disabled:opacity-60"
                        >
                            {locating ? t("locating") : busy ? "…" : t("checkInButton")}
                        </button>
                        <p className="text-xs text-foreground/50 mt-4">{t("locationNote")}</p>
                    </>
                )}

                {result?.kind === "approved" && (
                    <div role="status">
                        <div className="flex justify-center mb-3">
                            <InkStamp seed={qr} name={result.name} city={result.city} verified size={180} />
                        </div>
                        <p className="text-lg">{result.newStamp ? t("newStamp") : t("visitCounted")}</p>
                        <Link href="/passport" className="inline-block mt-4 underline">
                            {t("viewPassport")}
                        </Link>
                    </div>
                )}
                {result?.kind === "pending" && (
                    <div role="status">
                        <p className="text-lg mb-2">{t("pendingTitle")}</p>
                        <p className="text-foreground/70">{t("pendingBody")}</p>
                    </div>
                )}
                {result?.kind === "login" && (
                    <Link href={`/login?returnTo=${encodeURIComponent(`/passport/q/${qr}`)}`} className="underline">
                        {t("login")}
                    </Link>
                )}
                {result?.kind === "error" && (
                    <div role="alert">
                        <p className="text-lg mb-4">{t(`errors.${known.includes(result.reason) ? result.reason : "generic"}`)}</p>
                        <button type="button" onClick={() => setResult(null)} className="underline">
                            {t("tryAgain")}
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
