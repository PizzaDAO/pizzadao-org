"use client";

import { useCallback, useEffect, useState } from "react";

type Flag = { id: string; severity: "high" | "medium" | "low" | "info"; detail: string; source: string; hardBlock?: boolean; restricted?: boolean };
type Decision = {
    id: number;
    action: string;
    actorDiscordId: string;
    actorIsDpr: boolean;
    lane: string;
    riskScoreAtAction: number;
    note: string | null;
    proofRef: string | null;
    deployEnv: string | null;
    createdAt: string;
};
type Detail = {
    request: {
        id: string;
        status: string;
        lane: string;
        kind: string;
        source: string;
        requesterLabel: string;
        requesterDiscordId: string | null;
        claimedDiscordId: string | null;
        title: string;
        description: string;
        eventDate: string | null;
        eventCity: string | null;
        rsvEventSlug: string | null;
        amountUsd: number;
        currency: string;
        amountOriginal: number | null;
        payeeHint: string | null;
        proposalUrl: string | null;
        proposal: { id: string; title: string; status: string; amountUsd: number | null; ayes: number; nays: number; abstains: number } | null;
        riskScore: number;
        flags: Flag[];
        checkedAt: string | null;
        approvalsNeeded: number;
        createdAt: string;
        updatedAt: string;
        attachments: Array<{ id: string; kind: string; sizeBytes: number; mime: string; createdAt: string }>;
        checks: Array<{ id: number; kind: string; version: string; model: string | null; createdAt: string; flags: Flag[] }>;
        decisions: Decision[];
    };
    viewer: { discordId: string; isDpr: boolean; canMarkPaid: boolean };
    overCap: boolean;
    requiredAyes: number;
    proposalsOn: boolean;
    receiptUploadEnabled: boolean;
    aiChecksEnabled: boolean;
};

const SEV: Record<string, string> = {
    high: "bg-[hsl(var(--tomato)/0.18)] text-tomato",
    medium: "bg-[hsl(var(--butter)/0.4)]",
    low: "bg-[hsl(var(--ink)/0.08)]",
    info: "bg-[hsl(var(--ink)/0.05)]",
};

const field = "w-full min-h-10 px-3 rounded border bg-card";

export function PaymentDetail({ id }: { id: string }) {
    const [d, setD] = useState<Detail | null>(null);
    const [error, setError] = useState("");
    const [msg, setMsg] = useState("");
    const [note, setNote] = useState("");
    const [acked, setAcked] = useState<Set<string>>(new Set());
    const [passed, setPassed] = useState(false);
    const [ayes, setAyes] = useState("");
    const [proof, setProof] = useState("");
    const [paidTo, setPaidTo] = useState("");
    const [usd, setUsd] = useState("");
    const [fraud, setFraud] = useState(false);
    const [busy, setBusy] = useState(false);
    const [linkId, setLinkId] = useState("");

    const load = useCallback(async () => {
        try {
            const r = await fetch(`/api/admin/payments/${id}`, { cache: "no-store" });
            if (!r.ok) throw new Error();
            setD(await r.json());
            setError("");
        } catch {
            setError("Could not load this request.");
        }
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    async function post(url: string, init: RequestInit, okMsg: string) {
        setBusy(true);
        setMsg("");
        try {
            const r = await fetch(url, init);
            const body = await r.json().catch(() => ({}));
            if (!r.ok) setMsg(body.error ?? "Failed.");
            else {
                setMsg(okMsg + (body.awaiting === "top_role" ? " Waiting for the top review role." : body.awaiting === "more_approvals" ? " More approvals needed." : ""));
                setNote("");
                setProof("");
                setPaidTo("");
                setUsd("");
                setAcked(new Set());
            }
            await load();
        } finally {
            setBusy(false);
        }
    }

    function act(action: string, okMsg: string, extra: Record<string, unknown> = {}) {
        if (!d) return;
        void post(
            `/api/admin/payments/${id}/decision`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, note, expectedUpdatedAt: d.request.updatedAt, ...extra }),
            },
            okMsg,
        );
    }

    async function upload(file: File, kind: string) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", kind);
        await post(`/api/admin/payments/${id}/attachments`, { method: "POST", body: fd }, "File added.");
    }

    if (error) return <p className="m-0 text-tomato">{error}</p>;
    if (!d) return <p className="m-0 text-foreground/60">Loading...</p>;
    const r = d.request;
    const openFlags = r.flags.filter((f) => f.severity !== "info");
    const reviewable = r.status === "RECEIVED";
    const mine = d.viewer.discordId === r.requesterDiscordId;
    const approvals = new Set(r.decisions.filter((x) => x.action === "APPROVE").map((x) => x.actorDiscordId)).size;

    return (
        <article className="grid gap-5">
            <header className="grid gap-1">
                <h1 className="font-[family-name:var(--font-display)] font-black text-2xl m-0">{r.title}</h1>
                <p className="m-0 text-foreground/70">
                    {r.requesterLabel}{r.requesterDiscordId === null && r.claimedDiscordId ? ` (claimed id ${r.claimedDiscordId}, not verified)` : ""} · {r.kind.toLowerCase().replace("_", " ")} · {r.source.toLowerCase()} · lane {r.lane.toLowerCase().replace("_", " ")} · {r.status.toLowerCase().replace("_", " ")}
                </p>
                <p className="m-0 text-2xl tabular-nums">
                    ${r.amountUsd.toLocaleString("en-US")}
                    {r.currency !== "USD" && <span className="text-sm"> ({r.amountOriginal} {r.currency}, not converted)</span>}
                </p>
            </header>

            {r.amountUsd === 0 && (r.status === "RECEIVED" || r.status === "NEEDS_INFO") && (
                <div className="rounded p-3 bg-[hsl(var(--butter)/0.4)] grid gap-2 text-sm">
                    <p className="m-0">
                        The amount is in {r.currency} ({r.amountOriginal}) and has no dollar value yet. Approval is blocked until a reviewer enters it.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        <input className={field} inputMode="decimal" placeholder="USD value" value={usd} onChange={(e) => setUsd(e.target.value)} style={{ maxWidth: "12rem" }} />
                        <button
                            type="button"
                            disabled={busy || mine || !usd || !note.trim()}
                            className="min-h-10 px-4 rounded border"
                            onClick={() => post(`/api/admin/payments/${id}/usd-amount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountUsd: usd, note, expectedUpdatedAt: r.updatedAt }) }, "Dollar value recorded.")}
                        >
                            Record USD value (uses the note below as the reason)
                        </button>
                    </div>
                </div>
            )}

            {d.overCap && (
                <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">
                    {d.proposalsOn ? (
                        r.proposal ? (
                            <>
                                Above the on-approval cap: linked proposal{" "}
                                <a href={`/proposals/${r.proposal.id}`} className="underline">
                                    {r.proposal.title}
                                </a>{" "}
                                ({r.proposal.status.toLowerCase()}: {r.proposal.ayes} aye, {r.proposal.nays} nay, {r.proposal.abstains} abstain
                                {r.proposal.amountUsd != null ? `, passed for $${r.proposal.amountUsd}` : ""}). The vote is counted by the app.
                            </>
                        ) : (
                            <>
                                Above the on-approval cap: needs a passed in-app proposal, and none is linked.
                                {r.status === "RECEIVED" || r.status === "NEEDS_INFO" ? (
                                    <span className="mt-2 flex flex-wrap items-center gap-2">
                                        <input className={field} placeholder="Proposal link or id" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
                                        <button
                                            type="button"
                                            disabled={busy || !linkId.trim()}
                                            className="min-h-10 px-4 rounded border"
                                            onClick={() =>
                                                post(`/api/admin/payments/${id}/proposal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: linkId.trim().split("/").filter(Boolean).pop() }) }, "Proposal linked.")
                                            }
                                        >
                                            Link passed proposal
                                        </button>
                                    </span>
                                ) : null}
                            </>
                        )
                    ) : (
                        <>
                            Above the on-approval cap: needs a passed community poll with at least {d.requiredAyes} ayes.{" "}
                            {r.proposalUrl ? (
                                <a href={r.proposalUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                                    Poll link
                                </a>
                            ) : (
                                "No poll link was given."
                            )}
                        </>
                    )}
                </p>
            )}
            {r.rsvEventSlug && <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">This looks like a party event. Handle it on the party platform to avoid paying twice.</p>}

            <section className="grid gap-2">
                <h2 className="m-0 text-lg font-bold">Details</h2>
                <p className="m-0 whitespace-pre-wrap">{r.description}</p>
                <p className="m-0 text-sm text-foreground/70">
                    {r.eventDate ? `Event ${new Date(r.eventDate).toLocaleDateString()}` : "No event date"} · {r.eventCity ?? "no city"} · payee {r.payeeHint ?? "not stored"} · submitted {new Date(r.createdAt).toLocaleString()}
                </p>
            </section>

            <section className="grid gap-2">
                <h2 className="m-0 text-lg font-bold">
                    Flags <span className="text-sm font-normal">risk {r.riskScore}</span>
                </h2>
                {r.flags.length === 0 ? (
                    <p className="m-0 text-sm">No flags. This is not a check that the request is genuine.</p>
                ) : (
                    <ul className="m-0 p-0 list-none grid gap-1">
                        {r.flags.map((f) => (
                            <li key={f.id} className={`rounded px-2 py-1 text-sm ${SEV[f.severity]}`}>
                                <strong>{f.id.replace(/_/g, " ")}</strong> ({f.severity}
                                {f.hardBlock ? ", hard block" : ""}, {f.source}): {f.detail}
                            </li>
                        ))}
                    </ul>
                )}
                {(r.status === "RECEIVED" || r.status === "NEEDS_INFO" || r.status === "APPROVED") && (
                    <div className="flex flex-wrap gap-2">
                        {d.aiChecksEnabled && r.status !== "APPROVED" && (
                            <button
                                type="button"
                                disabled={busy}
                                className="min-h-9 px-3 rounded border text-sm"
                                onClick={() => post(`/api/admin/payments/${id}/ai-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "AI check finished. Its flags are help for you to look at; no flags does not mean verified.")}
                            >
                                Run AI check
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={busy}
                            className="min-h-9 px-3 rounded border text-sm"
                            onClick={() => post(`/api/admin/payments/${id}/recheck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "Checked again.")}
                        >
                            Re-check
                        </button>
                    </div>
                )}
                <p className="m-0 text-xs text-foreground/60">Flags are help for a person to decide; they never approve or reject anything.</p>
            </section>

            <section className="grid gap-2">
                <h2 className="m-0 text-lg font-bold">Files</h2>
                {r.attachments.length === 0 ? <p className="m-0 text-sm">No files.</p> : (
                    <ul className="m-0 pl-5">
                        {r.attachments.map((a) => (
                            <li key={a.id}>
                                <a className="underline" target="_blank" rel="noopener noreferrer" href={`/api/admin/payments/${r.id}/attachments/${a.id}`}>
                                    {a.kind.toLowerCase()} ({a.mime}, {Math.round(a.sizeBytes / 1024)} KB)
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
                {d.receiptUploadEnabled && (
                    <label className="text-sm grid gap-1">
                        Add a receipt (for example from the payments mailbox)
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "RECEIPT")} />
                    </label>
                )}
            </section>

            <section className="grid gap-2">
                <h2 className="m-0 text-lg font-bold">Timeline</h2>
                {r.decisions.length === 0 ? <p className="m-0 text-sm">No decisions yet.</p> : (
                    <ol className="m-0 pl-5 grid gap-1 text-sm">
                        {r.decisions.map((x) => (
                            <li key={x.id}>
                                {new Date(x.createdAt).toLocaleString()} · <strong>{x.action.toLowerCase().replace("_", " ")}</strong> by {x.actorDiscordId}
                                {x.actorIsDpr ? " (top role)" : ""} on {x.lane.toLowerCase().replace("_", " ")} lane, risk {x.riskScoreAtAction}
                                {x.deployEnv && x.deployEnv !== "production" ? ` [${x.deployEnv}]` : ""}
                                {x.proofRef ? ` · ref ${x.proofRef}` : ""}
                                {x.note ? ` — ${x.note}` : ""}
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <section className="grid gap-3 rounded border border-[hsl(var(--rule-warm)/0.55)] p-4">
                <h2 className="m-0 text-lg font-bold">
                    Decision · approvals {approvals}/{r.approvalsNeeded}
                </h2>
                {mine && <p className="m-0 text-sm text-tomato">This is your own request. You cannot act on it.</p>}

                {(reviewable || r.status === "APPROVED") && openFlags.length > 0 && (
                    <fieldset className="m-0 grid gap-1 border-0 p-0">
                        <legend className="font-semibold">Tick off each flag after you have looked at it</legend>
                        {openFlags.map((f) => (
                            <label key={f.id} className="flex gap-2 items-start text-sm">
                                <input
                                    type="checkbox"
                                    checked={acked.has(f.id)}
                                    onChange={(e) => {
                                        const n = new Set(acked);
                                        if (e.target.checked) n.add(f.id);
                                        else n.delete(f.id);
                                        setAcked(n);
                                    }}
                                />
                                <span>{f.id.replace(/_/g, " ")}</span>
                            </label>
                        ))}
                    </fieldset>
                )}
                {reviewable && d.overCap && !d.proposalsOn && (
                    <div className="grid gap-1 text-sm">
                        <label className="flex gap-2">
                            <input type="checkbox" checked={passed} onChange={(e) => setPassed(e.target.checked)} /> I checked that the community poll passed
                        </label>
                        <label className="grid gap-1">
                            Ayes counted (at least {d.requiredAyes})
                            <input className={field} inputMode="numeric" value={ayes} onChange={(e) => setAyes(e.target.value.replace(/\D/g, ""))} />
                        </label>
                    </div>
                )}

                <label className="grid gap-1 text-sm">
                    Note
                    <textarea className={`${field} min-h-24 py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                </label>

                {r.status === "APPROVED" && d.viewer.canMarkPaid && (
                    <label className="grid gap-1 text-sm">
                        Wallet or account you paid (compared with the request, never stored)
                        <input className={field} value={paidTo} onChange={(e) => setPaidTo(e.target.value)} maxLength={200} autoComplete="off" />
                    </label>
                )}
                {r.status === "APPROVED" && d.viewer.canMarkPaid && (
                    <label className="grid gap-1 text-sm">
                        Payment reference (transaction hash or transfer id; never an account number)
                        <input className={field} value={proof} onChange={(e) => setProof(e.target.value)} maxLength={200} autoComplete="off" />
                    </label>
                )}

                <div className="flex flex-wrap gap-2">
                    {reviewable && (
                        <button
                            type="button"
                            disabled={busy || mine}
                            className="min-h-10 px-4 rounded bg-foreground text-background disabled:opacity-40"
                            onClick={() => act("APPROVE", "Approval recorded.", { ackFlagIds: [...acked], checklist: { proposalPassed: passed }, ayesConfirmed: ayes ? Number(ayes) : undefined })}
                        >
                            Approve for payment
                        </button>
                    )}
                    {reviewable && (
                        <button type="button" disabled={busy || mine} className="min-h-10 px-4 rounded border" onClick={() => act("REQUEST_INFO", "Information requested.")}>
                            Ask for information
                        </button>
                    )}
                    {(r.status === "RECEIVED" || r.status === "NEEDS_INFO") && (
                        <>
                            <label className="flex gap-1 items-center text-sm">
                                <input type="checkbox" checked={fraud} onChange={(e) => setFraud(e.target.checked)} /> for fraud
                            </label>
                            <button type="button" disabled={busy || mine} className="min-h-10 px-4 rounded border border-tomato text-tomato" onClick={() => act("REJECT", "Rejected.", { asFraud: fraud })}>
                                Reject
                            </button>
                        </>
                    )}
                    {r.status === "APPROVED" && d.viewer.canMarkPaid && (
                        <button type="button" disabled={busy || mine} className="min-h-10 px-4 rounded bg-foreground text-background disabled:opacity-40" onClick={() => act("MARK_PAID", "Marked paid.", { proofRef: proof, paidTo, ackFlagIds: [...acked] })}>
                            Record as paid
                        </button>
                    )}
                    {d.viewer.isDpr && r.status !== "PAID" && r.status !== "RECEIVED" && (
                        <button type="button" disabled={busy || mine} className="min-h-10 px-4 rounded border" onClick={() => act("REOPEN", "Reopened.")}>
                            Reopen
                        </button>
                    )}
                    <button type="button" disabled={busy || mine} className="min-h-10 px-4 rounded border" onClick={() => act("NOTE", "Note added.")}>
                        Add note only
                    </button>
                </div>
                {msg && (
                    <p role="status" className="m-0 text-sm">
                        {msg}
                    </p>
                )}
            </section>
        </article>
    );
}
