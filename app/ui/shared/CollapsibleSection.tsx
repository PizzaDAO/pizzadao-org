"use client";

import { useState, type ReactNode } from "react";

/**
 * Shared collapsible section primitive.
 *
 * Used by both `/profile/[id]` and `/dashboard/[id]` to wrap a section in a
 * border-top header with an expand/collapse chevron. Visual output is identical
 * to the previous local copy in `app/profile/[id]/page.tsx` so that PR1 of the
 * profile redesign (plan `truffle-91035`) introduces no visual change — only an
 * extraction. The dashboard currently keeps its own (visually different) local
 * variant; a follow-up PR can switch it to this shared one.
 */
export function CollapsibleSection({
    title,
    icon,
    defaultOpen = false,
    children,
}: {
    title: string;
    icon?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-t border-rule pt-4">
            <button
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-2 bg-transparent border-0 p-0 text-left text-foreground font-display text-lg font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                aria-expanded={open}
            >
                <span
                    className="inline-block text-muted-foreground text-[10px] transition-transform duration-200"
                    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                    aria-hidden
                >
                    ▶
                </span>
                {icon}
                {title}
            </button>
            {open && <div className="mt-3">{children}</div>}
        </div>
    );
}
