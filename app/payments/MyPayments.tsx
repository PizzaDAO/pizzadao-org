"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { EditorialMasthead, paperCard, pillInk } from "@/app/ui/shared/Editorial";

type Mine = { id: string; title: string; kind: string; status: string; amountUsd: number; createdAt: string; question: string | null };
type FastTrack = { state: "ready" | "building"; paid: number; needed: number; missing: Array<"history" | "account_age" | "level"> };
type Data = { formEnabled: boolean; uploadsEnabled: boolean; fastTrack: FastTrack | null; requests: Mine[] };

export function MyPayments() {
    const t = useTranslations("payments");
    const locale = useLocale();
    const [data, setData] = useState<Data | null>(null);
    const [state, setState] = useState<"loading" | "login" | "error" | "ready">("loading");
    const [reply, setReply] = useState<Record<string, string>>({});
    const [msg, setMsg] = useState("");

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/payments", { cache: "no-store" });
            if (r.status === 401) return setState("login");
            if (!r.ok) throw new Error();
            setData(await r.json());
            setState("ready");
        } catch {
            setState("error");
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function act(id: string, action: "WITHDRAW" | "REPLY") {
        setMsg("");
        const r = await fetch(`/api/payments/${id}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, note: action === "REPLY" ? reply[id] ?? "" : undefined }),
        });
        setMsg(r.ok ? t(action === "WITHDRAW" ? "withdrawn" : "replied") : t("actionError"));
        if (r.ok) setReply((s) => ({ ...s, [id]: "" }));
        await load();
    }

    async function upload(id: string, file: File) {
        setMsg("");
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", "RECEIPT");
        const r = await fetch(`/api/payments/${id}/attachments`, { method: "POST", body: fd });
        setMsg(r.ok ? t("uploaded") : t("uploadError"));
    }

    const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

    return (
        <>
            <EditorialMasthead overline={t("overline")} title={t("title")} dek={t("dek")} />

            {state === "loading" && <p>{t("loading")}</p>}
            {state === "error" && <p className="text-tomato">{t("loadError")}</p>}
            {state === "login" && (
                <p>
                    {t("login")}{" "}
                    <Link href="/login?returnTo=/payments" className="underline">
                        {t("loginLink")}
                    </Link>
                </p>
            )}

            {state === "ready" && data && (
                <div className="grid gap-5">
                    <div className="flex flex-wrap items-center gap-4">
                        {data.formEnabled ? (
                            <Link href="/payments/new" className={pillInk}>
                                {t("newRequest")}
                            </Link>
                        ) : (
                            <p className="m-0 text-foreground/70">{t("closedNotice")}</p>
                        )}
                        <Link href="/budget" className="underline">
                            {t("guidelines")}
                        </Link>
                    </div>

                    {data.fastTrack && (
                        <section className={`${paperCard} p-4 grid gap-1`} aria-label={t("fastTitle")}>
                            <h2 className="m-0 font-display text-lg font-black">{t("fastTitle")}</h2>
                            {data.fastTrack.state === "ready" ? (
                                <p className="m-0">{t("fastReady")}</p>
                            ) : (
                                <>
                                    <p className="m-0">{t("fastBuilding", { paid: data.fastTrack.paid, needed: data.fastTrack.needed })}</p>
                                    {data.fastTrack.missing.length > 0 && (
                                        <ul className="m-0 pl-5 text-sm">
                                            {data.fastTrack.missing.map((m) => (
                                                <li key={m}>{t(`fastMissing.${m}` as never)}</li>
                                            ))}
                                        </ul>
                                    )}
                                </>
                            )}
                            <p className="m-0 text-sm text-foreground/70">{t("fastNote")}</p>
                        </section>
                    )}

                    {msg && (
                        <p role="status" className="m-0 text-sm">
                            {msg}
                        </p>
                    )}
                    {data.requests.length === 0 && <p>{t("none")}</p>}

                    <ul className="m-0 p-0 list-none grid gap-3">
                        {data.requests.map((r) => (
                            <li key={r.id} className={`${paperCard} p-4 grid gap-2`}>
                                <div className="flex flex-wrap items-baseline gap-x-3">
                                    <strong>{r.title}</strong>
                                    <span className="text-sm text-foreground/70">{t(`kind.${r.kind}` as never)}</span>
                                    <span className="ml-auto tabular-nums">${r.amountUsd.toLocaleString("en-US")}</span>
                                </div>
                                <p className="m-0 text-sm">
                                    {t(`status.${r.status}` as never)} · {t("submitted", { date: fmt.format(new Date(r.createdAt)) })}
                                </p>
                                {r.question && (
                                    <div className="rounded p-3 bg-[hsl(var(--butter)/0.35)] grid gap-2">
                                        <p className="m-0 text-sm font-semibold">{t("question")}</p>
                                        <p className="m-0 whitespace-pre-wrap">{r.question}</p>
                                        <label className="grid gap-1 text-sm">
                                            {t("replyLabel")}
                                            <textarea
                                                className="min-h-20 px-3 py-2 rounded border bg-card"
                                                maxLength={2000}
                                                value={reply[r.id] ?? ""}
                                                onChange={(e) => setReply((s) => ({ ...s, [r.id]: e.target.value }))}
                                            />
                                        </label>
                                        <button type="button" className="min-h-10 px-4 rounded bg-foreground text-background w-fit" disabled={!(reply[r.id] ?? "").trim()} onClick={() => act(r.id, "REPLY")}>
                                            {t("send")}
                                        </button>
                                    </div>
                                )}
                                {data.uploadsEnabled && (r.status === "RECEIVED" || r.status === "NEEDS_INFO") && (
                                    <label className="grid gap-1 text-sm">
                                        {t("uploadReceipt")}
                                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => e.target.files?.[0] && upload(r.id, e.target.files[0])} />
                                    </label>
                                )}
                                {(r.status === "RECEIVED" || r.status === "NEEDS_INFO") && (
                                    <button type="button" className="min-h-9 px-3 rounded border text-sm w-fit" onClick={() => act(r.id, "WITHDRAW")}>
                                        {t("withdraw")}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
}
