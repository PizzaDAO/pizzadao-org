"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { pillOutline } from "@/app/ui/shared/Editorial";

/** Withdraw the caller's own submission (by submission id). */
export function WithdrawButton({ submissionId }: { submissionId: string }) {
    const t = useTranslations("disavow.mine");
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            disabled={busy}
            className={`${pillOutline} cursor-pointer disabled:opacity-60`}
            onClick={async () => {
                setBusy(true);
                try {
                    await fetch(`/api/disavow/submissions/${submissionId}/withdraw`, { method: "POST" });
                } finally {
                    setBusy(false);
                    router.refresh();
                }
            }}
        >
            {t("withdraw")}
        </button>
    );
}
