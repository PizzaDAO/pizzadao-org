"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StampGrid, type StampItem } from "../ui/passport/StampGrid";

type Visibility = "public" | "members" | "private";

interface Me {
    enabled: boolean;
    visibility: Visibility;
    stamps: Array<Omit<StampItem, "month"> & { stampedAt: string }>;
}

export function PassportClient() {
    const t = useTranslations("passport");
    const [state, setState] = useState<"loading" | "login" | "off" | "ready">("loading");
    const [me, setMe] = useState<Me | null>(null);
    const [saveError, setSaveError] = useState(false);

    useEffect(() => {
        fetch("/api/passport/me", { cache: "no-store" })
            .then(async (r) => {
                if (r.status === 401) return setState("login");
                if (!r.ok) return setState("off");
                setMe((await r.json()) as Me);
                setState("ready");
            })
            .catch(() => setState("off"));
    }, []);

    async function setVisibility(visibility: Visibility) {
        setSaveError(false);
        const r = await fetch("/api/passport/visibility", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visibility }),
        }).catch(() => null);
        if (r?.ok) setMe((m) => (m ? { ...m, visibility } : m));
        else setSaveError(true);
    }

    return (
        <main className="min-h-screen bg-background text-foreground px-4 py-8">
            <div className="mx-auto max-w-2xl">
                <p className="overline text-tomato mb-1">{t("overline")}</p>
                <h1 className="text-3xl mb-2">{t("title")}</h1>
                <p className="text-foreground/70 mb-6">{t("intro")}</p>

                {state === "loading" && <p className="text-foreground/60">…</p>}
                {state === "off" && <p className="text-foreground/60">{t("unavailable")}</p>}
                {state === "login" && (
                    <Link href="/login?returnTo=/passport" className="underline">
                        {t("login")}
                    </Link>
                )}
                {state === "ready" && me && (
                    <>
                        {me.stamps.length === 0 ? (
                            <div className="rounded-[24px] border p-6" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
                                <h2 className="text-xl mb-1">{t("emptyTitle")}</h2>
                                <p className="text-foreground/70">{t("emptyBody")}</p>
                            </div>
                        ) : (
                            <StampGrid
                                stamps={me.stamps.map((s) => ({ ...s, month: s.stampedAt.slice(0, 7) }))}
                                size={150}
                            />
                        )}
                        <div className="mt-8">
                            <label htmlFor="passport-visibility" className="block text-sm mb-1">
                                {t("visibilityLabel")}
                            </label>
                            <select
                                id="passport-visibility"
                                value={me.visibility}
                                onChange={(e) => setVisibility(e.target.value as Visibility)}
                                className="rounded-md border px-3 py-2 bg-background"
                            >
                                <option value="public">{t("visibility.public")}</option>
                                <option value="members">{t("visibility.members")}</option>
                                <option value="private">{t("visibility.private")}</option>
                            </select>
                            <p className="text-xs text-foreground/50 mt-2">{t("privacyNote")}</p>
                            {saveError && <p className="text-sm text-tomato mt-2">{t("saveError")}</p>}
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
