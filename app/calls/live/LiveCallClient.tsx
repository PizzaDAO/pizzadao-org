"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EditorialMasthead, EditorialPage, paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";
import PersonLink from "@/app/ui/calls/PersonLink";
import type { LiveItemView, MemberCall, MemberLive, PublicLive } from "@/app/lib/calls/live-view";
import type { PollView, QuestionView } from "@/app/lib/calls/live-qa";

// Polling, not SSE: one small request every few seconds while the tab is visible. Signed-out visitors
// poll the CDN-cached public endpoint (count only); members poll their own uncached endpoint.
// Several calls can be live at once: one tab per call. Every action names its call.

const MAX_QUESTION = 280;

type PublicResponse = { calls: PublicLive[]; pollSeconds: number };
type CallState = PublicLive & Partial<Pick<MemberCall, "present" | "itemsLocked" | "questions" | "polls">>;

interface State {
    signedIn: boolean;
    calls: CallState[];
    isHost: boolean;
    pollSeconds: number;
}

const INITIAL: State = { signedIn: false, calls: [], isHost: false, pollSeconds: 10 };

export default function LiveCallClient() {
    const t = useTranslations("callsPage.live");
    const locale = useLocale();
    const [state, setState] = useState<State>(INITIAL);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [items, setItems] = useState<Record<string, LiveItemView[]>>({});
    const [selected, setSelected] = useState<string | null>(null);
    const cursors = useRef<Map<string, string>>(new Map());
    const signedIn = useRef<boolean | null>(null);
    const pollRef = useRef(10);

    const refresh = useCallback(async () => {
        try {
            if (signedIn.current !== false) {
                const params = new URLSearchParams();
                for (const [sid, cur] of cursors.current) params.append("after", `${sid}~${cur}`);
                const res = await fetch(`/api/calls/live${params.size ? `?${params}` : ""}`, { cache: "no-store" });
                if (res.status === 401) {
                    signedIn.current = false;
                } else if (res.ok) {
                    signedIn.current = true;
                    const data = (await res.json()) as MemberLive;
                    const liveIds = new Set(data.calls.map((c) => c.sessionId));
                    // Calls that ended: forget their cursors and items.
                    for (const sid of [...cursors.current.keys()]) if (!liveIds.has(sid)) cursors.current.delete(sid);
                    setItems((prev) => {
                        const next: Record<string, LiveItemView[]> = {};
                        for (const c of data.calls) {
                            const seen = new Set((prev[c.sessionId] ?? []).map((i) => i.id));
                            next[c.sessionId] = [...(prev[c.sessionId] ?? []), ...c.items.filter((i) => !seen.has(i.id))];
                        }
                        return next;
                    });
                    for (const c of data.calls) if (c.itemsCursor) cursors.current.set(c.sessionId, c.itemsCursor);
                    setState({ signedIn: true, calls: data.calls, isHost: data.isHost, pollSeconds: data.pollSeconds });
                    setLoadError(false);
                    setLoaded(true);
                    return;
                } else {
                    throw new Error(String(res.status));
                }
            }
            const res = await fetch("/api/calls/live/public");
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as PublicResponse;
            setState({ ...INITIAL, calls: data.calls, pollSeconds: data.pollSeconds });
            setLoadError(false);
            setLoaded(true);
        } catch {
            setLoadError(true);
            setLoaded(true);
        }
    }, []);

    // Poll while the tab is visible; refresh right away when it comes back.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let stopped = false;
        const loop = async () => {
            if (stopped) return;
            if (!document.hidden) await refresh();
            if (!stopped) timer = setTimeout(loop, Math.max(5, pollRef.current) * 1000);
        };
        const onVisible = () => {
            if (!document.hidden) {
                if (timer) clearTimeout(timer);
                void loop();
            }
        };
        void loop();
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [refresh]);
    pollRef.current = state.pollSeconds;

    const calls = state.calls;
    const live = calls.find((c) => c.sessionId === selected) ?? calls[0] ?? null;

    return (
        <EditorialPage width="max-w-[820px]">
            <Link href="/calls" className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                {t("backToCalls")}
            </Link>
            <EditorialMasthead overline={t("overline")} title={live ? live.title || t("untitled") : t("title")} />

            {loadError && <p role="status" className="mb-4 text-sm text-foreground/70">{t("errors.load")}</p>}

            {calls.length > 1 && (
                <div role="tablist" aria-label={t("callsTabs")} className="mb-5 flex flex-wrap gap-2">
                    {calls.map((c) => (
                        <button
                            key={c.sessionId}
                            type="button"
                            role="tab"
                            aria-selected={c.sessionId === live?.sessionId}
                            onClick={() => setSelected(c.sessionId)}
                            className={`btn-pill min-h-11 min-w-0 max-w-full break-words border px-4 text-sm ${c.sessionId === live?.sessionId ? "bg-foreground text-background" : "bg-transparent border-[hsl(var(--foreground)/0.25)]"}`}
                        >
                            {c.title || c.crewLabel || t("untitled")}
                        </button>
                    ))}
                </div>
            )}

            {!live ? (
                loaded && (
                    <section className={`${paperCard} p-5`}>
                        <h2 className="m-0 text-xl font-bold">{t("noCallTitle")}</h2>
                        <p className="mt-2 text-foreground/70">{t("noCallBody")}</p>
                        <div className="mt-4 flex flex-wrap gap-3">
                            <Link href="/calls/how-to-attend" className={pillOutline}>{t("scheduleLink")}</Link>
                            <Link href="/calls/recordings" className={pillOutline}>{t("recordingsLink")}</Link>
                        </div>
                    </section>
                )
            ) : (
                <LiveCall key={live.sessionId} live={live} state={state} items={items[live.sessionId] ?? []} onChanged={refresh} locale={locale} />
            )}
        </EditorialPage>
    );
}

function LiveCall({ live, state, items, onChanged, locale }: { live: CallState; state: State; items: LiveItemView[]; onChanged: () => void; locale: string }) {
    const t = useTranslations("callsPage.live");
    const started = useMemo(() => new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(live.startedAt)), [live.startedAt, locale]);
    return (
        <div className="grid min-w-0 gap-5">
            <section className={`${paperCard} min-w-0 p-5`}>
                <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-tomato-deep px-3 py-1 text-xs font-bold uppercase tracking-wide text-cream">
                        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-cream" />
                        {t("liveBadge")}
                    </span>
                    {live.crewLabel && <span className="text-sm font-semibold">{live.crewLabel}</span>}
                    <span className="text-sm text-foreground/70">{t("startedAt", { time: started })}</span>
                </div>
                <p className="mt-3 mb-0 text-foreground/80">{t("headCount", { count: live.presentCount })}</p>
                {live.streamLink && (
                    <a href={live.streamLink} target="_blank" rel="noopener noreferrer" className={`${pillInk} mt-4`}>
                        {t("watchStream")}
                    </a>
                )}
                {state.isHost && <StreamLinkEditor sessionId={live.sessionId} current={live.streamLink} onChanged={onChanged} />}
            </section>

            {!state.signedIn ? (
                <section className={`${paperCard} p-5`}>
                    <p className="m-0 text-foreground/80">{t("presentSignIn")}</p>
                    <Link href="/login?returnTo=%2Fcalls%2Flive" className={`${pillInk} mt-4`}>{t("signIn")}</Link>
                </section>
            ) : (
                <>
                    <PresentSection present={live.present ?? []} />
                    <ItemsSection items={items} locked={live.itemsLocked ?? null} />
                    <PollsSection sessionId={live.sessionId} polls={live.polls ?? []} isHost={state.isHost} onChanged={onChanged} />
                    <QaSection sessionId={live.sessionId} questions={live.questions ?? []} isHost={state.isHost} onChanged={onChanged} />
                </>
            )}
        </div>
    );
}

function StreamLinkEditor({ sessionId, current, onChanged }: { sessionId: string; current: string | null; onChanged: () => void }) {
    const t = useTranslations("callsPage.live");
    const { run, error, busy } = useAction(sessionId, onChanged);
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(current ?? "");
    if (!open) return <button type="button" className={`${smallBtn} mt-3`} onClick={() => setOpen(true)}>{t("streamEdit")}</button>;
    return (
        <form
            className="mt-3 grid gap-2"
            onSubmit={async (e) => {
                e.preventDefault();
                if (await run({ op: "setStreamLink", link: value.trim() || null })) setOpen(false);
            }}
        >
            <label className="grid gap-1 text-sm font-semibold">
                {t("streamLabel")}
                <input value={value} maxLength={500} inputMode="url" placeholder="https://x.com/i/broadcasts/..." onChange={(e) => setValue(e.target.value)} className="min-h-11 w-full rounded-md border border-[hsl(var(--foreground)/0.25)] bg-background px-3 font-normal" />
            </label>
            <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={`${pillInk} disabled:opacity-50`}>{t("streamSave")}</button>
                <button type="button" className={smallBtn} onClick={() => setOpen(false)}>{t("streamCancel")}</button>
            </div>
            {error && <p role="alert" className="m-0 text-sm text-tomato-readable">{error}</p>}
        </form>
    );
}

// ---- shared ------------------------------------------------------------------------------------

function useAction(sessionId: string, onChanged: () => void) {
    const t = useTranslations("callsPage.live");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const run = useCallback(
        async (body: Record<string, unknown>): Promise<boolean> => {
            setBusy(true);
            setError(null);
            try {
                const res = await fetch("/api/calls/live/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
                if (!res.ok) {
                    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "generic";
                    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
                    return false;
                }
                onChanged();
                return true;
            } catch {
                setError(t("errors.generic"));
                return false;
            } finally {
                setBusy(false);
            }
        },
        [sessionId, onChanged, t],
    );
    return { run, error, busy };
}

const smallBtn = "btn-pill min-h-11 bg-transparent text-foreground border border-[hsl(var(--foreground)/0.25)] px-3 text-sm hover:bg-[hsl(var(--foreground)/0.06)] disabled:opacity-50";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className={`${paperCard} min-w-0 p-5`}>
            <h2 className="m-0 mb-3 text-xl font-bold">{title}</h2>
            {children}
        </section>
    );
}

// ---- present -----------------------------------------------------------------------------------

function PresentSection({ present }: { present: NonNullable<MemberCall["present"]> }) {
    const t = useTranslations("callsPage.live");
    return (
        <Section title={t("present")}>
            {present.length === 0 ? (
                <p className="m-0 text-foreground/70">{t("nobodyListed")}</p>
            ) : (
                <ul className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-1 p-0 sm:grid-cols-2">
                    {present.map((p, i) => (
                        <li key={`${p.memberId ?? p.name}-${i}`} className="flex min-w-0 items-baseline justify-between gap-3">
                            <PersonLink name={p.name ?? t("memberAsker")} memberId={p.memberId} className="min-w-0 break-words" />
                            <span className="shrink-0 text-sm text-foreground/60">{t("minutes", { count: p.minutes })}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

// ---- action items ------------------------------------------------------------------------------

function ItemsSection({ items, locked }: { items: LiveItemView[]; locked: number | null }) {
    const t = useTranslations("callsPage.live");
    return (
        <Section title={t("actionItems")}>
            {locked !== null ? (
                <p className="m-0 text-foreground/70">{t("itemsLocked", { level: locked })}</p>
            ) : items.length === 0 ? (
                <p className="m-0 text-foreground/70">{t("itemsEmpty")}</p>
            ) : (
                <>
                    <ul className="m-0 grid list-none gap-3 p-0">
                        {items.map((it) => (
                            <li key={it.id} className="min-w-0 break-words">
                                <span className="font-medium">{it.text}</span>
                                {(it.owner || it.suggestedBy?.name) && (
                                    <span className="mt-0.5 block text-sm text-foreground/60">
                                        {it.owner && <span className="mr-3">{t("owner", { name: it.owner })}</span>}
                                        {it.suggestedBy?.name && (
                                            <span>
                                                {t.rich("suggestedBy", { name: () => <PersonLink key="n" name={it.suggestedBy!.name!} memberId={it.suggestedBy!.memberId} /> })}
                                            </span>
                                        )}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 mb-0 text-xs text-foreground/50">{t("itemsNote")}</p>
                </>
            )}
        </Section>
    );
}

// ---- polls -------------------------------------------------------------------------------------

function PollsSection({ sessionId, polls, isHost, onChanged }: { sessionId: string; polls: PollView[]; isHost: boolean; onChanged: () => void }) {
    const t = useTranslations("callsPage.live");
    const { run, error, busy } = useAction(sessionId, onChanged);
    if (polls.length === 0 && !isHost) return null;
    return (
        <Section title={t("pollsTitle")}>
            {error && <p role="alert" className="mt-0 mb-3 text-sm text-tomato-readable">{error}</p>}
            {polls.length === 0 && <p className="m-0 mb-3 text-foreground/70">{t("pollsEmpty")}</p>}
            <div className="grid gap-4">
                {polls.map((p) => (
                    <div key={p.id} className="min-w-0 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.55)] p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
                            <span className="font-semibold uppercase tracking-wide">{t(p.status === "open" ? "pollStatusOpen" : p.status === "closed" ? "pollStatusClosed" : "pollStatusDraft")}</span>
                            {p.createdBy?.name && (
                                <span>{t.rich("pollBy", { name: () => <PersonLink key="n" name={p.createdBy!.name!} memberId={p.createdBy!.memberId} /> })}</span>
                            )}
                        </div>
                        <p className="mt-1 mb-3 break-words font-semibold">{p.question}</p>
                        <ul className="m-0 grid list-none gap-2 p-0">
                            {p.options.map((o, i) => {
                                const mine = p.myVote === i;
                                const canVote = p.status === "open";
                                const inner = (
                                    <span className="relative block w-full overflow-hidden rounded-md border border-[hsl(var(--foreground)/0.2)] px-3 py-2 text-left">
                                        {o.percent !== null && (
                                            <span aria-hidden className="absolute inset-y-0 left-0 bg-[hsl(var(--tomato)/0.18)]" style={{ width: `${o.percent}%` }} />
                                        )}
                                        <span className="relative flex items-baseline justify-between gap-3">
                                            <span className={`min-w-0 break-words ${mine ? "font-bold" : ""}`}>{mine ? "✓ " : ""}{o.text}</span>
                                            {o.percent !== null && <span className="shrink-0 text-sm">{o.percent}% · {o.votes}</span>}
                                        </span>
                                    </span>
                                );
                                return (
                                    <li key={i}>
                                        {canVote ? (
                                            <button type="button" disabled={busy} aria-pressed={mine} className="block min-h-11 w-full bg-transparent p-0" onClick={() => void run({ op: "pollVote", pollId: p.id, option: i })}>
                                                {inner}
                                            </button>
                                        ) : (
                                            inner
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        <p className="mt-2 mb-0 text-xs text-foreground/60">
                            {p.total !== null ? t("pollVotes", { count: p.total }) : p.status === "open" ? t("pollResultsHidden") : ""}
                            {p.status === "open" && p.myVote !== null ? ` · ${t("pollChangeHint")}` : ""}
                        </p>
                        {isHost && (
                            <div className="mt-3 flex flex-wrap gap-2" aria-label={t("hostControls")}>
                                {p.status === "draft" && <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "pollAction", pollId: p.id, action: "open" })}>{t("pollOpen")}</button>}
                                {p.status === "open" && <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "pollAction", pollId: p.id, action: "close" })}>{t("pollClose")}</button>}
                                {p.status !== "closed" && (
                                    <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "pollAction", pollId: p.id, action: p.showResults ? "hideResults" : "showResults" })}>
                                        {p.showResults ? t("pollHideNow") : t("pollShowNow")}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {isHost && <NewPoll run={run} busy={busy} />}
        </Section>
    );
}

function NewPoll({ run, busy }: { run: (b: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
    const t = useTranslations("callsPage.live");
    const [open, setOpen] = useState(false);
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState(["", ""]);
    const [showResults, setShowResults] = useState(false);
    const ready = question.trim().length >= 3 && options.filter((o) => o.trim()).length >= 2;
    if (!open) {
        return <button type="button" className={`${smallBtn} mt-4`} onClick={() => setOpen(true)}>{t("pollNew")}</button>;
    }
    return (
        <form
            className="mt-4 grid gap-2"
            onSubmit={async (e) => {
                e.preventDefault();
                if (await run({ op: "createPoll", question, options: options.filter((o) => o.trim()), showResults })) {
                    setQuestion("");
                    setOptions(["", ""]);
                    setShowResults(false);
                    setOpen(false);
                }
            }}
        >
            <label className="grid gap-1 text-sm font-semibold">
                {t("pollQuestion")}
                <input value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} className="min-h-11 w-full rounded-md border border-[hsl(var(--foreground)/0.25)] bg-background px-3 font-normal" />
            </label>
            {options.map((o, i) => (
                <div key={i} className="flex gap-2">
                    <input
                        aria-label={t("pollOption", { n: i + 1 })}
                        placeholder={t("pollOption", { n: i + 1 })}
                        value={o}
                        maxLength={80}
                        onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        className="min-h-11 min-w-0 flex-1 rounded-md border border-[hsl(var(--foreground)/0.25)] bg-background px-3"
                    />
                    {options.length > 2 && (
                        <button type="button" className={smallBtn} aria-label={t("pollRemoveOption")} onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>×</button>
                    )}
                </div>
            ))}
            {options.length < 6 && <button type="button" className={`${smallBtn} justify-self-start`} onClick={() => setOptions((p) => [...p, ""])}>{t("pollAddOption")}</button>}
            <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} className="h-5 w-5" />
                {t("pollShowResults")}
            </label>
            <button type="submit" disabled={!ready || busy} className={`${pillInk} justify-self-start disabled:opacity-50`}>{t("pollCreate")}</button>
        </form>
    );
}

// ---- Q&A ---------------------------------------------------------------------------------------

function QaSection({ sessionId, questions, isHost, onChanged }: { sessionId: string; questions: QuestionView[]; isHost: boolean; onChanged: () => void }) {
    const t = useTranslations("callsPage.live");
    const { run, error, busy } = useAction(sessionId, onChanged);
    const [sort, setSort] = useState<"top" | "new">("top");
    const [text, setText] = useState("");
    const [anonymous, setAnonymous] = useState(false);

    const sorted = useMemo(() => {
        const rank = (q: QuestionView) => (q.pinned ? 0 : q.answered ? 2 : 1);
        return [...questions].sort((a, b) => rank(a) - rank(b) || (sort === "top" ? b.votes - a.votes || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt)));
    }, [questions, sort]);

    return (
        <Section title={t("qaTitle")}>
            <form
                className="grid gap-2"
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run({ op: "ask", text, anonymous })) setText("");
                }}
            >
                <label className="grid gap-1 text-sm font-semibold">
                    <span className="sr-only">{t("askLabel")}</span>
                    <textarea
                        value={text}
                        maxLength={MAX_QUESTION}
                        rows={2}
                        placeholder={t("askPlaceholder")}
                        aria-label={t("askLabel")}
                        onChange={(e) => setText(e.target.value)}
                        className="w-full rounded-md border border-[hsl(var(--foreground)/0.25)] bg-background p-3 font-normal"
                    />
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="h-5 w-5 shrink-0" />
                    {t("askAnonymous")}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" disabled={busy || text.trim().length < 3} className={`${pillInk} disabled:opacity-50`}>{t("askSubmit")}</button>
                    <span className="text-xs text-foreground/60">{t("askCounter", { count: text.length, max: MAX_QUESTION })}</span>
                </div>
                {error && <p role="alert" className="m-0 text-sm text-tomato-readable">{error}</p>}
            </form>

            <div className="mt-5 flex items-center justify-between gap-3" role="group" aria-label={t("sortLabel")}>
                <div className="flex gap-2">
                    <button type="button" aria-pressed={sort === "top"} className={`${smallBtn} ${sort === "top" ? "font-bold" : ""}`} onClick={() => setSort("top")}>{t("sortTop")}</button>
                    <button type="button" aria-pressed={sort === "new"} className={`${smallBtn} ${sort === "new" ? "font-bold" : ""}`} onClick={() => setSort("new")}>{t("sortNew")}</button>
                </div>
            </div>

            {sorted.length === 0 ? (
                <p className="mt-4 mb-0 text-foreground/70">{t("qaEmpty")}</p>
            ) : (
                <ul className="mt-4 mb-0 grid list-none gap-3 p-0">
                    {sorted.map((q) => (
                        <li key={q.id} className={`min-w-0 rounded-[var(--radius)] border p-3 ${q.pinned ? "border-[hsl(var(--tomato))] bg-[hsl(var(--tomato)/0.08)]" : "border-[hsl(var(--rule-warm)/0.55)]"} ${q.answered ? "opacity-70" : ""}`}>
                            <div className="flex items-start gap-3">
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-pressed={q.voted}
                                    aria-label={q.voted ? t("upvoted") : t("upvote")}
                                    onClick={() => void run({ op: "vote", questionId: q.id })}
                                    className={`flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded-md border px-2 text-sm ${q.voted ? "border-[hsl(var(--tomato))] bg-[hsl(var(--tomato)/0.15)] font-bold" : "border-[hsl(var(--foreground)/0.25)]"}`}
                                >
                                    <span aria-hidden>▲</span>
                                    <span>{q.votes}</span>
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className="m-0 break-words">{q.text}</p>
                                    <p className="mt-1 mb-0 flex flex-wrap gap-x-3 text-xs text-foreground/60">
                                        {q.pinned && <span className="font-semibold text-tomato-readable">{t("pinned")}</span>}
                                        {q.answered && <span className="font-semibold">{t("answered")}</span>}
                                        <span>
                                            {q.anonymous ? (
                                                q.author?.name ? t("anonymousToHost", { name: q.author.name }) : t("anonymousAsker")
                                            ) : q.author?.name ? (
                                                t.rich("askedBy", { name: () => <PersonLink key="n" name={q.author!.name!} memberId={q.author!.memberId} /> })
                                            ) : (
                                                t("memberAsker")
                                            )}
                                            {q.mine ? ` (${t("you")})` : ""}
                                        </span>
                                        {q.hidden && <span className="font-semibold">{t("hiddenNote")}</span>}
                                    </p>
                                    {isHost && (
                                        <div className="mt-2 flex flex-wrap gap-2" aria-label={t("hostControls")}>
                                            <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "moderate", questionId: q.id, action: q.pinned ? "unpin" : "pin" })}>{q.pinned ? t("unpin") : t("pin")}</button>
                                            <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "moderate", questionId: q.id, action: q.answered ? "unanswer" : "answer" })}>{q.answered ? t("markUnanswered") : t("markAnswered")}</button>
                                            <button type="button" disabled={busy} className={smallBtn} onClick={() => void run({ op: "moderate", questionId: q.id, action: q.hidden ? "unhide" : "hide" })}>{q.hidden ? t("unhide") : t("hide")}</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
