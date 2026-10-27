"use client";

// app/admin/calls/PostFilters.tsx
//
// Private editor for the automated-post filters. Only rendered inside the reviewer-gated
// /admin/calls page; the API enforces the same check.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PostFiltersValue {
    excludedCrewIds: string[];
    excludedCrewLabelTerms: string[];
    blockedTerms: string[];
}

export interface PostFiltersLabels {
    title: string;
    description: string;
    crewIds: string;
    crewLabelTerms: string;
    blockedTerms: string;
    save: string;
    saving: string;
    saved: string;
    error: string;
}

const toText = (l: string[]) => l.join("\n");
const toList = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);

export function PostFilters({ initial, labels }: { initial: PostFiltersValue; labels: PostFiltersLabels }) {
    const router = useRouter();
    const [ids, setIds] = useState(toText(initial.excludedCrewIds));
    const [terms, setTerms] = useState(toText(initial.excludedCrewLabelTerms));
    const [blocked, setBlocked] = useState(toText(initial.blockedTerms));
    const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

    async function save() {
        setState("saving");
        try {
            const res = await fetch("/api/admin/calls/post-filters", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ excludedCrewIds: toList(ids), excludedCrewLabelTerms: toList(terms), blockedTerms: toList(blocked) }),
            });
            if (!res.ok) return setState("error");
            setState("saved");
            router.refresh();
        } catch {
            setState("error");
        }
    }

    const area = "w-full rounded-xl border bg-card p-2 text-sm font-mono";
    return (
        <section className="grid gap-3">
            <h2 className="font-[family-name:var(--font-display)] font-black text-xl m-0">{labels.title}</h2>
            <p className="m-0 text-foreground/70">{labels.description}</p>
            <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm">
                    {labels.crewIds}
                    <textarea className={area} rows={4} value={ids} onChange={(e) => { setIds(e.target.value); setState("idle"); }} style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }} />
                </label>
                <label className="grid gap-1 text-sm">
                    {labels.crewLabelTerms}
                    <textarea className={area} rows={4} value={terms} onChange={(e) => { setTerms(e.target.value); setState("idle"); }} style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }} />
                </label>
                <label className="grid gap-1 text-sm">
                    {labels.blockedTerms}
                    <textarea className={area} rows={4} value={blocked} onChange={(e) => { setBlocked(e.target.value); setState("idle"); }} style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }} />
                </label>
            </div>
            <div className="flex items-center gap-3">
                <button type="button" onClick={save} disabled={state === "saving"} className="rounded-full border px-4 py-1.5 text-sm font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                    {state === "saving" ? labels.saving : labels.save}
                </button>
                {state === "saved" && <span className="text-sm">{labels.saved}</span>}
                {state === "error" && <span className="text-sm text-tomato">{labels.error}</span>}
            </div>
        </section>
    );
}
