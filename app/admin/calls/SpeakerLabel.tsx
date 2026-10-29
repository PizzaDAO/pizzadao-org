"use client";

// app/admin/calls/SpeakerLabel.tsx
//
// Name a diarized speaker of an imported call, or link a PizzaDAO member. Guests stay "Speaker N".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isReviewDirty } from "./reviewDirty";

interface MemberHit {
    discordId: string;
    name: string;
}

export function SpeakerLabel({ recordingId, speakerId, name, linked }: { recordingId: string; speakerId: string; name: string | null; linked: boolean }) {
    const t = useTranslations("adminCalls");
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(name ?? "");
    const [member, setMember] = useState<MemberHit | null>(null);
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<MemberHit[]>([]);
    const [state, setState] = useState<"idle" | "working" | "error">("idle");

    async function search(q: string) {
        setQuery(q);
        if (q.trim().length < 2) return setHits([]);
        try {
            const res = await fetch(`/api/admin/calls/members?q=${encodeURIComponent(q.trim())}`);
            const data = (await res.json().catch(() => null)) as { members?: MemberHit[] } | null;
            setHits(res.ok ? (data?.members ?? []) : []);
        } catch {
            setHits([]);
        }
    }

    async function send(body: Record<string, unknown>) {
        if (isReviewDirty() && !window.confirm(t("unsavedWarning"))) return;
        setState("working");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/speakers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ speakerId, ...body }),
            });
            if (!res.ok) return setState("error");
            setState("idle");
            setOpen(false);
            router.refresh();
        } catch {
            setState("error");
        }
    }

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="underline text-sm">
                {t("labelSpeaker")}
            </button>
        );
    }

    return (
        <span className="grid gap-2 mt-1 mb-2 rounded-xl border p-3" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
            <span className="text-sm text-foreground/70">{t("labelHelp")}</span>
            <label className="grid gap-1 text-sm">
                {t("labelName")}
                <input value={text} maxLength={40} onChange={(e) => setText(e.target.value)} className="rounded-lg border px-2 py-1 bg-background" />
            </label>
            <label className="grid gap-1 text-sm">
                {t("labelFindMember")}
                <input value={query} onChange={(e) => search(e.target.value)} className="rounded-lg border px-2 py-1 bg-background" />
            </label>
            {hits.length > 0 && (
                <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                    {hits.map((h) => (
                        <li key={h.discordId}>
                            <button
                                type="button"
                                className="underline text-sm"
                                onClick={() => {
                                    setMember(h);
                                    setText(h.name);
                                    setHits([]);
                                    setQuery("");
                                }}
                            >
                                {h.name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {(member || linked) && (
                <span className="text-sm text-foreground/70">
                    {t("labelLinked")}
                    {member ? `: ${member.name}` : ""}
                </span>
            )}
            <span className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={state === "working" || (!text.trim() && !member)}
                    onClick={() => send(member ? { linkedDiscordId: member.discordId, displayName: text } : { displayName: text })}
                    className="underline text-sm"
                >
                    {state === "working" ? t("working") : t("labelSave")}
                </button>
                <button type="button" disabled={state === "working"} onClick={() => send({})} className="underline text-sm text-foreground/70">
                    {t("labelReset")}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="underline text-sm text-foreground/70">
                    {t("cancel")}
                </button>
                {state === "error" && <span className="text-tomato text-sm">{t("reviewError")}</span>}
            </span>
        </span>
    );
}
