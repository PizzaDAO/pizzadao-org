"use client";

import Link from "next/link";

/**
 * Confirm dialog shown before vouching for a person on the private disavow
 * list. Rendered only for eligible viewers (AddVouchButton asks the server).
 * Warn only: "Vouch anyway" proceeds with the vouch.
 */
export interface VouchWarningStrings {
    title: string; body: string; confirm: string; cancel: string; view: string;
}

export function DisavowVouchWarning({
    entryId,
    strings: t0,
    onConfirm,
    onCancel,
}: {
    entryId: string;
    strings: VouchWarningStrings;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const t = (k: keyof VouchWarningStrings) => t0[k];
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="dv-vouch-title" className="grid w-full max-w-md gap-4 rounded-2xl bg-card p-6 text-card-foreground shadow-lg">
                <h2 id="dv-vouch-title" className="m-0 text-lg font-black">{t("title")}</h2>
                <p className="m-0">{t("body")}</p>
                <Link href={`/disavow/${entryId}`} className="text-sm font-semibold underline">{t("view")}</Link>
                <div className="flex flex-wrap gap-3">
                    <button type="button" autoFocus onClick={onCancel} className="btn-pill min-h-11 cursor-pointer border border-[hsl(var(--foreground)/0.25)] bg-transparent text-foreground">
                        {t("cancel")}
                    </button>
                    <button type="button" onClick={onConfirm} className="btn-pill min-h-11 cursor-pointer border border-transparent bg-tomato-deep text-cream">
                        {t("confirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
