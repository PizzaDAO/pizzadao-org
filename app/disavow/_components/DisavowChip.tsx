"use client";

import Link from "next/link";

/**
 * Red private warning chip. Rendered only for eligible viewers; the server
 * passes the already-translated label, so the root message catalog never
 * contains disavow text.
 */
export function DisavowChip({ id, label }: { id: string; label: string }) {
    return (
        <Link
            href={`/disavow/${id}`}
            data-testid="disavow-chip"
            className="mb-3 inline-flex min-h-11 items-center rounded-full border border-red-700 bg-red-700 px-4 text-sm font-bold text-white no-underline"
        >
            {label}
        </Link>
    );
}
