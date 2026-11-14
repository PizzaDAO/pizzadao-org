"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewsletterSections } from "@/app/lib/newsletter/sections";

type View = {
  issue: {
    id: string;
    slug: string;
    status: string;
    issueDate: string;
    subject: string;
    preheader: string;
    xSpaceUrl: string | null;
    sponsorNotified: boolean;
    sections: NewsletterSections;
    model: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    updatedAt: string;
  };
  readOnly: boolean;
  preview: { subject: string; html: string; text: string };
  blockers: string[];
  canApprove: boolean;
  candidates: { members: Array<{ id: number; name: string; city: string; status: string }>; cities: Array<{ key: string; name: string }> };
  flags: { draftEnabled: boolean; senderConfigured: boolean; emailEnabled: boolean };
  audit: Array<{ action: string; actor: string | null; at: string }>;
};

type Form = {
  subject: string;
  preheader: string;
  issueDate: string;
  xSpaceUrl: string;
  sponsorNotified: boolean;
  sections: NewsletterSections;
};

const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
const btn = "rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50";

function toForm(v: View): Form {
  const i = v.issue;
  return { subject: i.subject, preheader: i.preheader, issueDate: i.issueDate, xSpaceUrl: i.xSpaceUrl ?? "", sponsorNotified: i.sponsorNotified, sections: i.sections };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-bold">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function IssueEditor({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [tab, setTab] = useState<"html" | "text">("html");
  const [cityKey, setCityKey] = useState("");
  const [cityNotes, setCityNotes] = useState("");
  const [memberId, setMemberId] = useState("");

  const apply = useCallback((v: View) => {
    setView(v);
    const f = toForm(v);
    setForm(f);
    setSaved(JSON.stringify(f));
  }, []);

  const call = useCallback(
    async (label: string, url: string, init?: RequestInit) => {
      setBusy(label);
      setMsg(null);
      try {
        const res = await fetch(url, { cache: "no-store", ...init });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
        return body as View & { ok?: boolean };
      } catch (err) {
        setMsg({ kind: "err", text: err instanceof Error ? err.message : "Request failed" });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const v = await call("load", `/api/admin/newsletter/issues/${id}`);
      if (v) apply(v);
    })();
  }, [id, call, apply]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== saved, [form, saved]);
  const editable = view ? !view.readOnly && (view.issue.status === "draft" || view.issue.status === "approved") : false;

  if (!view || !form) {
    return (
      <main className="min-h-screen bg-background text-foreground p-5 max-w-2xl mx-auto">
        {msg ? <p role="alert" className="text-destructive">{msg.text}</p> : <p>Loading…</p>}
      </main>
    );
  }

  const s = form.sections;
  const setS = (patch: Partial<NewsletterSections>) => setForm({ ...form, sections: { ...s, ...patch } });

  const patchBody = (extra: Record<string, unknown> = {}) => ({
    subject: form.subject,
    preheader: form.preheader,
    issueDate: form.issueDate,
    xSpaceUrl: form.xSpaceUrl.trim() || null,
    sections: s,
    sponsorNotified: form.sponsorNotified,
    updatedAt: view.issue.updatedAt,
    ...extra,
  });

  const save = async (extra: Record<string, unknown> = {}, okText = "Saved.") => {
    const v = await call("save", `/api/admin/newsletter/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody(extra)),
    });
    if (v) {
      apply(v);
      setMsg({ kind: "ok", text: view.issue.status === "approved" ? "Saved. The issue was approved, so it is a draft again and needs a new approval." : okText });
    }
  };

  const post = async (label: string, path: string, okText: string) => {
    const v = await call(label, `/api/admin/newsletter/issues/${id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updatedAt: view.issue.updatedAt }),
    });
    if (v) {
      if (path === "test-send") setMsg({ kind: "ok", text: okText });
      else {
        apply(v);
        setMsg({ kind: "ok", text: okText });
      }
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-5 max-w-5xl mx-auto grid gap-6 content-start">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin/newsletter" className="text-sm underline">
            All issues
          </Link>
          <h1 className="text-2xl font-black m-0">Issue {view.issue.slug}</h1>
        </div>
        <span className="rounded-full border px-3 py-1 text-sm font-bold">{view.issue.status}</span>
      </div>

      {msg ? (
        <p role={msg.kind === "err" ? "alert" : "status"} className={`m-0 rounded-xl border p-3 ${msg.kind === "err" ? "text-destructive" : ""}`}>
          {msg.text}
        </p>
      ) : null}
      {!editable ? <p className="m-0 rounded-xl border p-3">A {view.issue.status} issue can&apos;t be edited.</p> : null}
      {view.issue.status === "approved" ? (
        <p className="m-0 rounded-xl border p-3">
          Approved{view.issue.approvedAt ? ` on ${view.issue.approvedAt.slice(0, 10)}` : ""}. Any edit turns it back into a draft.
        </p>
      ) : null}
      {view.issue.model ? <p className="m-0 text-sm text-foreground/60">Drafted with {view.issue.model}. Review every line before approving.</p> : null}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="grid gap-5">
          <fieldset disabled={!editable || !!busy} className="grid gap-5 border-0 p-0 m-0 min-w-0">
            <Field label="Subject">
              <input className={input} value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
            <Field label="Preheader">
              <input className={input} value={form.preheader} maxLength={300} onChange={(e) => setForm({ ...form, preheader: e.target.value })} />
            </Field>
            <Field label="Opening">
              <textarea className={input} rows={4} value={s.intro} maxLength={2000} onChange={(e) => setS({ intro: e.target.value })} />
            </Field>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">X Space invite</h2>
              <Toggle checked={s.xSpace.enabled} onChange={(v) => setS({ xSpace: { ...s.xSpace, enabled: v } })} label="Show the invite" />
              <Field label="Issue date (the wording says &quot;today&quot; on the Space day)">
                <input type="date" className={input} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
              </Field>
              <Field label="Space link (empty uses the X profile from Settings)">
                <input className={input} value={form.xSpaceUrl} placeholder="https://x.com/i/spaces/..." onChange={(e) => setForm({ ...form, xSpaceUrl: e.target.value })} />
              </Field>
              <Field label="Headline">
                <input className={input} value={s.xSpace.headline} onChange={(e) => setS({ xSpace: { ...s.xSpace, headline: e.target.value } })} />
              </Field>
              <Field label="Detail">
                <input className={input} value={s.xSpace.detail} onChange={(e) => setS({ xSpace: { ...s.xSpace, detail: e.target.value } })} />
              </Field>
              <p className="m-0 text-xs text-foreground/60">Changing the date or the link rebuilds this block when you save.</p>
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">Member Spotlight</h2>
              <Toggle checked={s.member.enabled} onChange={(v) => setS({ member: { ...s.member, enabled: v } })} label="Include" />
              <div className="flex gap-2">
                <select className={input} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  <option value="">Pick a shortlisted or featured member…</option>
                  {view.candidates.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.city ? `, ${m.city}` : ""} ({m.status.toLowerCase()})
                    </option>
                  ))}
                </select>
                <button type="button" className={btn} disabled={!memberId} onClick={() => save({ pickMember: Number(memberId) }, "Member picked.")}>
                  Use
                </button>
              </div>
              <Field label="Name">
                <input className={input} value={s.member.name} onChange={(e) => setS({ member: { ...s.member, name: e.target.value } })} />
              </Field>
              <Field label="Text">
                <textarea className={input} rows={5} value={s.member.blurb} onChange={(e) => setS({ member: { ...s.member, blurb: e.target.value } })} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">City Spotlight</h2>
              <Toggle checked={s.city.enabled} onChange={(v) => setS({ city: { ...s.city, enabled: v } })} label="Include" />
              <div className="flex gap-2">
                <select className={input} value={cityKey} onChange={(e) => setCityKey(e.target.value)}>
                  <option value="">Pick a city…</option>
                  {view.candidates.cities.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={btn} disabled={!cityKey} onClick={() => save({ pickCity: { key: cityKey, notes: cityNotes || s.city.notes } }, "City picked.")}>
                  Use
                </button>
              </div>
              <Field label="Notes (for the draft)">
                <textarea className={input} rows={3} value={cityKey ? cityNotes : s.city.notes} onChange={(e) => (cityKey ? setCityNotes(e.target.value) : setS({ city: { ...s.city, notes: e.target.value } }))} />
              </Field>
              <Field label={`Text${s.city.name ? ` (${s.city.name})` : ""}`}>
                <textarea className={input} rows={4} value={s.city.blurb} onChange={(e) => setS({ city: { ...s.city, blurb: e.target.value } })} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">Partner Spotlight</h2>
              <Toggle checked={s.partner.enabled} onChange={(v) => setS({ partner: { ...s.partner, enabled: v } })} label="Include" />
              <Field label="Partner name">
                <input className={input} value={s.partner.name} onChange={(e) => setS({ partner: { ...s.partner, name: e.target.value } })} />
              </Field>
              <Field label="Website">
                <input className={input} value={s.partner.website} placeholder="https://" onChange={(e) => setS({ partner: { ...s.partner, website: e.target.value } })} />
              </Field>
              <Field label="Logo URL">
                <input className={input} value={s.partner.logoUrl} placeholder="https://" onChange={(e) => setS({ partner: { ...s.partner, logoUrl: e.target.value } })} />
              </Field>
              <Field label="Text">
                <textarea className={input} rows={4} value={s.partner.blurb} onChange={(e) => setS({ partner: { ...s.partner, blurb: e.target.value } })} />
              </Field>
              <Toggle checked={form.sponsorNotified} onChange={(v) => setForm({ ...form, sponsorNotified: v })} label="Sponsor notified (we told them before sending)" />
              <Field label="Notice note (internal, never in the email)">
                <input className={input} value={s.partner.notifiedNote} maxLength={500} onChange={(e) => setS({ partner: { ...s.partner, notifiedNote: e.target.value } })} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">Upcoming events</h2>
              <Toggle checked={s.events.enabled} onChange={(v) => setS({ events: { ...s.events, enabled: v } })} label="Include" />
              <Field label="Intro (optional)">
                <input className={input} value={s.events.intro} onChange={(e) => setS({ events: { ...s.events, intro: e.target.value } })} />
              </Field>
              {s.events.items.length === 0 ? <p className="m-0 text-sm text-foreground/60">No scheduled events in the window.</p> : null}
              {s.events.items.map((ev, n) => (
                <Toggle
                  key={ev.id}
                  checked={ev.included}
                  label={`${ev.name} (${ev.startsAt.slice(0, 16).replace("T", " ")} UTC)`}
                  onChange={(v) => setS({ events: { ...s.events, items: s.events.items.map((x, k) => (k === n ? { ...x, included: v } : x)) } })}
                />
              ))}
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">Call updates</h2>
              <Toggle checked={s.calls.enabled} onChange={(v) => setS({ calls: { ...s.calls, enabled: v } })} label="Include" />
              <Field label="Intro (optional)">
                <input className={input} value={s.calls.intro} onChange={(e) => setS({ calls: { ...s.calls, intro: e.target.value } })} />
              </Field>
              {s.calls.crews.length === 0 ? <p className="m-0 text-sm text-foreground/60">No published calls since the last issue.</p> : null}
              {s.calls.crews.map((c, n) => (
                <div key={c.id} className="grid gap-2 rounded-lg border p-2">
                  <Toggle checked={c.included} label={c.label} onChange={(v) => setS({ calls: { ...s.calls, crews: s.calls.crews.map((x, k) => (k === n ? { ...x, included: v } : x)) } })} />
                  <textarea
                    className={input}
                    rows={3}
                    value={c.summary}
                    onChange={(e) => setS({ calls: { ...s.calls, crews: s.calls.crews.map((x, k) => (k === n ? { ...x, summary: e.target.value } : x)) } })}
                  />
                  {c.shipped.length ? (
                    <ul className="m-0 pl-5 text-sm">
                      {c.shipped.map((sh, j) => (
                        <li key={j}>{sh}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </section>

            <section className="grid gap-3 rounded-xl border p-3">
              <h2 className="text-lg font-bold m-0">New articles</h2>
              {s.articles.items.length === 0 ? (
                <p className="m-0 text-sm text-foreground/60">No articles were published since the last issue; the section is left out.</p>
              ) : (
                <>
                  <Toggle checked={s.articles.enabled} onChange={(v) => setS({ articles: { ...s.articles, enabled: v } })} label="Include" />
                  <Field label="Intro (optional)">
                    <input className={input} value={s.articles.intro} onChange={(e) => setS({ articles: { ...s.articles, intro: e.target.value } })} />
                  </Field>
                  {s.articles.items.map((a, n) => (
                    <Toggle
                      key={a.id}
                      checked={a.included}
                      label={`${a.title}${a.author ? `, ${a.author}` : ""}`}
                      onChange={(v) => setS({ articles: { ...s.articles, items: s.articles.items.map((x, k) => (k === n ? { ...x, included: v } : x)) } })}
                    />
                  ))}
                </>
              )}
            </section>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            {view.readOnly ? <p className="m-0 text-sm text-foreground/60">Read-only view: you can approve or unapprove, not edit.</p> : null}
            {!view.readOnly ? (
              <button type="button" className={btn} disabled={!editable || !dirty || !!busy} onClick={() => save()}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
            ) : null}
            {view.flags.draftEnabled && !view.readOnly ? (
              <button
                type="button"
                className={btn}
                disabled={!editable || dirty || !!busy}
                title="Rewrite the wording with the model (your selections stay)"
                onClick={() => {
                  if (window.confirm("Rewrite the text with the model? Text it writes replaces your edits in those fields.")) void post("redraft", "redraft", "Redrafted.");
                }}
              >
                Redraft with AI
              </button>
            ) : null}
            <button
              type="button"
              className={`${btn} ${view.readOnly ? "hidden" : ""}`}
              disabled={dirty || !!busy || !view.flags.senderConfigured || !view.flags.emailEnabled}
              title={view.flags.senderConfigured && view.flags.emailEnabled ? "Email this saved version to your own verified address" : "Needs a sender address and the newsletter email switch on"}
              onClick={() => void post("test", "test-send", "Test sent to your own verified address.")}
            >
              Send test to me
            </button>
            {view.issue.status === "draft" ? (
              <button type="button" className={btn} disabled={dirty || !!busy || !view.canApprove || view.blockers.length > 0} onClick={() => void post("approve", "approve", "Approved.")}>
                Approve
              </button>
            ) : null}
            {view.issue.status === "approved" ? (
              <button type="button" className={btn} disabled={!!busy} onClick={() => void post("unapprove", "unapprove", "Back to draft.")}>
                Unapprove
              </button>
            ) : null}
          </div>
          {view.issue.status === "draft" && !view.canApprove ? <p className="m-0 text-sm text-foreground/60">You don&apos;t have the approver role, so only the Approve button is unavailable to you.</p> : null}
          {view.issue.status === "draft" && view.blockers.length ? (
            <ul className="m-0 pl-5 text-sm text-foreground/70">
              {view.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {dirty ? <p className="m-0 text-sm text-foreground/60">Unsaved changes. Save before sending a test or approving.</p> : null}

          {view.audit.length ? (
            <section className="grid gap-1">
              <h2 className="text-lg font-bold m-0">History</h2>
              {view.audit.map((a, n) => (
                <p key={n} className="m-0 text-sm text-foreground/70">
                  {a.at.slice(0, 16).replace("T", " ")} · {a.action}
                </p>
              ))}
            </section>
          ) : null}
        </div>

        <div className="grid gap-3 lg:sticky lg:top-4">
          <div className="flex gap-2">
            <button type="button" className={btn} aria-pressed={tab === "html"} onClick={() => setTab("html")}>
              HTML preview
            </button>
            <button type="button" className={btn} aria-pressed={tab === "text"} onClick={() => setTab("text")}>
              Plain text
            </button>
          </div>
          <p className="m-0 text-xs text-foreground/60">Shows the last saved version.</p>
          {tab === "html" ? (
            <iframe title="Email preview" sandbox="" srcDoc={view.preview.html} className="w-full h-[70vh] rounded-xl border bg-white" />
          ) : (
            <pre className="m-0 whitespace-pre-wrap rounded-xl border p-3 text-sm max-h-[70vh] overflow-auto">{view.preview.text}</pre>
          )}
        </div>
      </div>
    </main>
  );
}
