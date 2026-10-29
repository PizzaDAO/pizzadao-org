"use client";

// app/ui/profile/PassportBlock.tsx
//
// Pizza Passport on the profile (plans/pizza-passport.md section 8). Renders nothing while the
// feature is off, when the passport is hidden from this viewer, or when there are no stamps and
// the viewer is not the owner. Other viewers get month-only dates and a delay (set in admin
// settings), enforced by the API.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StampGrid, type StampItem } from "../passport/StampGrid";

interface ApiResponse {
    enabled: boolean;
    isOwner?: boolean;
    stamps: Array<StampItem & { slug: string; countryCode: string | null }>;
}

const VISIBLE = 6;

export function PassportBlock({ memberId }: { memberId: string }) {
    const t = useTranslations("passport");
    const [data, setData] = useState<ApiResponse | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/passport/${encodeURIComponent(memberId)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: ApiResponse | null) => {
                if (!cancelled) setData(j);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [memberId]);

    if (!data?.enabled) return null;
    const owner = !!data.isOwner;
    if (data.stamps.length === 0 && !owner) return null;

    const countries = new Set(data.stamps.map((s) => s.countryCode).filter(Boolean)).size;
    const verified = data.stamps.filter((s) => s.verified).length;

    return (
        <section
            className="paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <p className="overline text-tomato mb-1">{t("overline")}</p>
            {data.stamps.length > 0 ? (
                <>
                    <p className="text-sm text-foreground/70 mb-4">
                        {t("summary", { stamps: data.stamps.length, countries, verified })}
                    </p>
                    <StampGrid stamps={data.stamps.slice(0, VISIBLE)} />
                </>
            ) : (
                <p className="text-sm text-foreground/70 mb-2">{t("emptyBody")}</p>
            )}
            {owner && (
                <Link href="/passport" className="inline-block mt-4 underline text-sm">
                    {data.stamps.length > VISIBLE || data.stamps.length === 0 ? t("seeAll") : t("manage")}
                </Link>
            )}
        </section>
    );
}
