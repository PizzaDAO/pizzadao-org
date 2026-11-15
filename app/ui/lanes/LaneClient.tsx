"use client";

// Interactive bits of the lane guide (plans/lane-cards-mission-onboarding.md): pin on arrival from a
// community card, the "make this my lane" button, and a tickable step. Step text is rendered on the
// server and passed in as `children`.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

async function post(url: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * After a pin or a tick the dashboard's lane card and next action are out of date, but the summary
 * is cached for a minute (React Query staleTime, the response's max-age, and the route's in-memory
 * entry). Re-fetch it with `fresh=1` (the route rebuilds its entry and answers no-store) past the
 * HTTP cache (`reload`) and mark the query stale, so the dashboard
 * shows the change on the next visit. Best effort; failures are ignored.
 */
export function useRefreshDashboardSummary(memberId: string) {
    const queryClient = useQueryClient();
    return () => {
        void fetch(`/api/dashboard-summary?memberId=${encodeURIComponent(memberId)}&fresh=1`, { cache: "reload" })
            .catch(() => undefined)
            .finally(() => void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }));
    };
}

/** When the page was opened from a community card (?pick=1), pin the lane once and drop the param. */
export function PinOnArrive({ slug, pick, memberId }: { slug: string; pick: boolean; memberId: string }) {
    const router = useRouter();
    const refreshSummary = useRefreshDashboardSummary(memberId);
    const done = useRef(false);
    useEffect(() => {
        if (!pick || done.current) return;
        done.current = true;
        void post("/api/lanes/pin", { slug, source: "card" }).then((ok) => {
            if (ok) refreshSummary();
            router.replace(`/lanes/${slug}`);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- pin once per arrival
    }, [pick, slug, router]);
    return null;
}

export function PinButton({ slug, memberId, label, busyLabel, errorLabel }: { slug: string; memberId: string; label: string; busyLabel: string; errorLabel: string }) {
    const router = useRouter();
    const refreshSummary = useRefreshDashboardSummary(memberId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    return (
        <span className="inline-flex flex-col gap-1">
            <button
                type="button"
                disabled={busy}
                onClick={async () => {
                    setBusy(true);
                    setError(false);
                    const ok = await post("/api/lanes/pin", { slug, source: "guide" });
                    setBusy(false);
                    if (ok) {
                        refreshSummary();
                        router.refresh();
                    } else setError(true);
                }}
                className="btn-pill min-h-11 border border-[hsl(var(--foreground)/0.25)] bg-transparent text-foreground hover:bg-[hsl(var(--foreground)/0.06)] disabled:opacity-50"
            >
                {busy ? busyLabel : label}
            </button>
            {error && <span role="alert" className="text-sm text-tomato">{errorLabel}</span>}
        </span>
    );
}

export function LaneStepItem({
    slug, memberId, stepId, index, title, kind, initialDone, linkHref, linkLabel, markDone, markUndone, submitHint, submitHref, submitLabel, errorLabel, children,
}: {
    slug: string;
    memberId: string;
    stepId: string;
    index: number;
    title: string;
    kind: string;
    initialDone: boolean;
    linkHref: string | null;
    linkLabel: string | null;
    markDone: string;
    markUndone: string;
    submitHint: string;
    /** Where a "submit" step sends the member (the mission). */
    submitHref: string | null;
    /** Link text for a "submit" step. */
    submitLabel: string;
    errorLabel: string;
    children?: ReactNode;
}) {
    const refreshSummary = useRefreshDashboardSummary(memberId);
    const [done, setDone] = useState(initialDone);
    const [error, setError] = useState(false);
    const isSubmit = kind === "submit";
    // A submit step always links to the mission (never an admin-set link) and only while that mission is open.
    const href = isSubmit ? submitHref : linkHref;
    const label = isSubmit ? submitLabel : linkLabel || linkHref;
    const external = !isSubmit && !!href && /^https:/.test(href);

    async function toggle() {
        const next = !done;
        setDone(next);
        setError(false);
        const ok = await post("/api/lanes/progress", { slug, stepId, done: next });
        if (!ok) {
            setDone(!next);
            setError(true);
        } else {
            refreshSummary();
        }
    }

    return (
        <li className="grid gap-2 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.55)] p-4 sm:p-5" data-done={done ? "true" : "false"}>
            <div className="flex items-start gap-3">
                {isSubmit ? (
                    <span aria-hidden className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded border border-[hsl(var(--foreground)/0.4)] text-xs">{done ? "✓" : ""}</span>
                ) : (
                    <input
                        type="checkbox"
                        checked={done}
                        onChange={() => void toggle()}
                        aria-label={`${done ? markUndone : markDone}: ${title}`}
                        className="mt-1 h-5 w-5 shrink-0"
                    />
                )}
                <div className="grid min-w-0 flex-1 gap-2">
                    <h3 className="font-display m-0 text-lg font-extrabold leading-tight">
                        <span className="text-foreground/50">{index}. </span>
                        {title}
                    </h3>
                    {children}
                    {isSubmit && <p className="m-0 text-sm text-foreground/70">{submitHint}</p>}
                    {href && (
                        external ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="w-fit text-sm underline underline-offset-2">
                                {label}
                            </a>
                        ) : (
                            <Link href={href} className="w-fit text-sm underline underline-offset-2">
                                {label}
                            </Link>
                        )
                    )}
                    {error && <span role="alert" className="text-sm text-tomato">{errorLabel}</span>}
                </div>
            </div>
        </li>
    );
}
