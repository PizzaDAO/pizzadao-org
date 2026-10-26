"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** Red "Disavowed (private)" chip. Rendered only for eligible viewers (server decides). */
export function DisavowChip({ id }: { id: string }) {
    const t = useTranslations("disavow.chip");
    return (
        <Link
            href={`/disavow/${id}`}
            data-testid="disavow-chip"
            className="mb-3 inline-flex min-h-11 items-center rounded-full border border-red-700 bg-red-700 px-4 text-sm font-bold text-white no-underline"
        >
            {t("label")}
        </Link>
    );
}
