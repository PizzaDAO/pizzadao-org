"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Overview = {
  counts: { confirmed: number; pending: number; legacyUnconfirmed: number; unsubscribed: number };
  senderConfigured: boolean;
  resendConfigured: boolean;
  production: boolean;
  confirmEmailsEnabled: boolean;
  memberOptInEnabled: boolean;
};

type IssueRow = { id: string; slug: string; status: string; subject: string; issueDate: string };

function Issues() {
  const [issues, setIssues] = useState<IssueRow[] | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/newsletter/issues", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      setIssues(((await res.json()) as { issues: IssueRow[] }).issues);
    } catch {
      setError("Couldn't load the issues.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/newsletter/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueDate: date }) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't create the draft");
      window.location.href = `/admin/newsletter/${body.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the draft");
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-bold m-0">Issues</h2>
      {error ? <p role="alert" className="m-0 text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="font-bold">Issue date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-background px-3 py-2" />
        </label>
        <button type="button" disabled={busy || !date} onClick={() => void create()} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50">
          {busy ? "Drafting…" : "Create draft"}
        </button>
      </div>
      <p className="m-0 text-xs text-foreground/60">Gathers the calls, articles and events since the last sent issue. Nothing is sent.</p>
      {issues === null ? <p className="m-0">Loading…</p> : issues.length === 0 ? <p className="m-0">No issues yet.</p> : null}
      {issues?.map((i) => (
        <p key={i.id} className="m-0">
          <Link href={`/admin/newsletter/${i.id}`} className="underline">
            {i.slug}
          </Link>{" "}
          · {i.status} · {i.subject || "(no subject)"}
        </p>
      ))}
    </section>
  );
}

export function AdminNewsletterClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/newsletter/subscribers", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      setData(await res.json());
    } catch {
      setError("Couldn't load the newsletter overview.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const c = data?.counts;
  return (
    <main className="min-h-screen bg-background text-foreground p-5 max-w-2xl mx-auto grid gap-6 content-start">
      <h1 className="text-2xl font-black m-0">Newsletter</h1>
      {error ? <p role="alert" className="m-0 text-destructive">{error}</p> : null}
      <Issues />
      {data ? (
        <>
          {!data.senderConfigured ? (
            <p role="status" className="m-0 rounded-xl border p-3">
              No sender address is configured, so no newsletter email is sent (confirmation emails stay unsent and signups remain
              pending). Set the sender name, address and reply-to under Settings, Newsletter.
            </p>
          ) : null}
          <section className="grid gap-1">
            <h2 className="text-lg font-bold m-0">Subscribers</h2>
            <p className="m-0">Confirmed (mailable): {c!.confirmed}</p>
            <p className="m-0">Pending confirmation: {c!.pending}</p>
            <p className="m-0">Legacy, never confirmed (never mailed; they can re-subscribe from the form): {c!.legacyUnconfirmed}</p>
            <p className="m-0">Unsubscribed: {c!.unsubscribed}</p>
          </section>
          <section className="grid gap-1">
            <h2 className="text-lg font-bold m-0">Switches</h2>
            <p className="m-0">Confirmation emails: {data.confirmEmailsEnabled ? "on" : "off"}</p>
            <p className="m-0">Member checkbox: {data.memberOptInEnabled ? "on" : "off"}</p>
          </section>
        </>
      ) : error ? null : (
        <p className="m-0">Loading…</p>
      )}
    </main>
  );
}
