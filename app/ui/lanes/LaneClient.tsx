"use client";

// Interactive bits of the lane guide (plans/lane-cards-mission-onboarding.md): pin on arrival from a
// community card, the "make this my lane" button, and a tickable step. Step text is rendered on the
// server and passed in as `children`.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

/** When the page was opened from a community card (?pick=1), pin the lane once and drop the param. */
export function PinOnArrive({ slug, pick }: { slug: string; pick: boolean }) {
    const router = useRouter();
    const done = useRef(false);
    useEffect(() => {
        if (!pick || done.current) return;
        done.current = true;
        void post("/api/lanes/pin", { slug, source: "card" }).then(() => router.replace(`/lanes/${slug}`));
    }, [pick, slug, router]);
    return null;
}

export function PinButton({ slug, label, busyLabel, errorLabel }: { slug: string; label: string; busyLabel: string; errorLabel: string }) {
    const router = useRouter();
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
                    if (ok) router.refresh();
                    else setError(true);
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
    slug, stepId, index, title, kind, initialDone, linkHref, linkLabel, markDone, markUndone, submitHint, submitHref, errorLabel, children,
}: {
    slug: string;
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
    errorLabel: string;
    children?: ReactNode;
}) {
    const [done, setDone] = useState(initialDone);
    const [error, setError] = useState(false);
    const isSubmit = kind === "submit";
    const external = !!linkHref && /^https:/.test(linkHref);

    async function toggle() {
        const next = !done;
        setDone(next);
        setError(false);
        const ok = await post("/api/lanes/progress", { slug, stepId, done: next });
        if (!ok) {
            setDone(!next);
            setError(true);
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
                    {(isSubmit ? submitHref : linkHref) && (
                        external ? (
                            <a href={linkHref as string} target="_blank" rel="noopener noreferrer" className="w-fit text-sm underline underline-offset-2">
                                {linkLabel || linkHref}
                            </a>
                        ) : (
                            <Link href={(isSubmit ? submitHref : linkHref) as string} className="w-fit text-sm underline underline-offset-2">
                                {linkLabel || (isSubmit ? submitHref : linkHref)}
                            </Link>
                        )
                    )}
                    {error && <span role="alert" className="text-sm text-tomato">{errorLabel}</span>}
                </div>
            </div>
        </li>
    );
}
