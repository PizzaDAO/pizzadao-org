"use client";

// Download button for the member's saved PFP (the composed picture, as a PNG). Shown only when a
// saved PFP exists: a HEAD request to the download route answers 200 or 404 without fetching the image.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function PfpDownload({ memberId }: { memberId: string }) {
    const t = useTranslations("dashboard.hero");
    const [saved, setSaved] = useState(false);
    const href = `/api/pfp/${encodeURIComponent(memberId)}/download`;

    useEffect(() => {
        let alive = true;
        Promise.resolve(fetch(href, { method: "HEAD" }))
            .then((r) => alive && setSaved(!!r?.ok))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [href]);

    if (!saved) return null;
    return (
        <span className="grid gap-1" data-testid="pfp-download">
            <a
                href={href}
                download="pizzadao-pfp.png"
                className="btn-pill"
                style={{
                    minHeight: 44,
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    border: "1.5px solid hsl(var(--rule-warm) / 0.7)",
                    textDecoration: "none",
                }}
            >
                {t("downloadPfp")}
            </a>
            <span className="text-[12px] text-foreground/70">{t("downloadPfpHint")}</span>
        </span>
    );
}
