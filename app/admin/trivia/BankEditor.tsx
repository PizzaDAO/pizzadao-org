"use client";

// app/admin/trivia/BankEditor.tsx
//
// The question bank editor (admin only: the page renders it only for an admin, and every call goes to
// /api/admin/trivia/questions, which checks again). List and filter the bank, create and edit questions (a form for the
// usual fields, raw JSON for everything), approve / flag / retire, move pools. The server validates every save
// (QuestionSchema + matcher lint) and shows why a save was refused.
//
// Exposed questions: their answer is public (in git history, or revealed by a closed round or a served daily), so the
// daily and the Discord rounds avoid them and practice serves them. The id is public too, so rewording the question
// keeps the flag; only a genuinely new answer clears it (or clearing it by hand).
//
// Live questions: changing today's web daily's status or pool re-points the daily and deletes today's attempts, and
// the open Discord round's answer cannot change until it closes (the server refuses): both ask before saving.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, DIFFICULTIES, MATCH_KINDS, POOLS, QUESTION_TYPES, STATUSES, type TriviaQuestion } from "@/app/lib/trivia/schema";
import type { AdminQuestionRow } from "@/app/lib/trivia/bank-admin";

const btn = "min-h-11 rounded-xl border px-4 font-semibold disabled:opacity-50";
const btnStyle = { borderColor: "hsl(var(--rule-warm) / 0.65)" };
const input = "w-full rounded-lg border bg-transparent px-3 py-2 text-sm";
const inputStyle = { borderColor: "hsl(var(--rule-warm) / 0.65)" };

interface FormState {
  id: string;
  category: string;
  type: string;
  difficulty: string;
  question: string;
  choices: string;
  answer: string;
  aliases: string;
  rejects: string;
  matchKind: string;
  fuzzy: boolean;
  tolerance: string;
  explanation: string;
  sources: string;
  notes: string;
  label: string;
  validUntil: string;
  status: string;
  pool: string;
  rejectedReason: string;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function toForm(q: Partial<TriviaQuestion>): FormState {
  return {
    id: q.id ?? "",
    category: q.category ?? "pizzadao",
    type: q.type ?? "short_answer",
    difficulty: q.difficulty ?? "medium",
    question: q.question ?? "",
    choices: (q.choices ?? []).join("\n"),
    answer: q.answer ?? "",
    aliases: (q.aliases ?? []).join("\n"),
    rejects: (q.rejects ?? []).join("\n"),
    matchKind: q.match?.kind ?? "text",
    fuzzy: q.match?.fuzzy ?? false,
    tolerance: q.match?.tolerance === undefined ? "" : String(q.match.tolerance),
    explanation: q.explanation ?? "",
    sources: (q.sources ?? []).map((s) => `${s.url} | ${s.note}`).join("\n"),
    notes: q.notes ?? "",
    label: q.label ?? "",
    validUntil: q.validUntil ?? "",
    status: q.status ?? "flagged",
    pool: q.pool ?? "",
    rejectedReason: q.rejectedReason ?? "",
  };
}

/** The form as a question object (the server validates it). Empty optional fields are left out. */
function fromForm(f: FormState): Record<string, unknown> {
  const match: Record<string, unknown> = { kind: f.matchKind };
  if (f.matchKind === "text") match.fuzzy = f.fuzzy;
  if (f.matchKind === "number" && f.tolerance.trim() !== "") match.tolerance = Number(f.tolerance);
  const q: Record<string, unknown> = {
    id: f.id.trim(),
    category: f.category,
    type: f.type,
    difficulty: f.difficulty,
    question: f.question.trim(),
    answer: f.answer.trim(),
    aliases: lines(f.aliases),
    rejects: lines(f.rejects),
    match,
    explanation: f.explanation.trim(),
    sources: lines(f.sources).map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? { url: l.trim(), note: "" } : { url: l.slice(0, i).trim(), note: l.slice(i + 1).trim() };
    }),
    status: f.status,
  };
  if (f.type === "multiple_choice") q.choices = lines(f.choices);
  if (f.notes.trim()) q.notes = f.notes.trim();
  if (f.label.trim()) q.label = f.label.trim();
  if (f.validUntil.trim()) q.validUntil = f.validUntil.trim();
  if (f.status === "approved" && f.pool) q.pool = f.pool;
  if (f.status === "rejected" && f.rejectedReason.trim()) q.rejectedReason = f.rejectedReason.trim();
  return q;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-foreground/60">{hint}</span>}
    </label>
  );
}

function Select({ value, onChange, options, empty }: { value: string; onChange: (v: string) => void; options: readonly string[]; empty?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input} style={inputStyle}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

type Editing = { mode: "create" } | { mode: "edit"; row: AdminQuestionRow };

/** The question ids live right now: today's web daily and the open Discord round's question. */
export interface LiveIds {
  daily: string | null;
  discord: string | null;
}

const gradingKey = (q: Partial<TriviaQuestion> | Record<string, unknown>) => {
  const x = q as Partial<TriviaQuestion>;
  return JSON.stringify([x.answer, x.aliases ?? [], x.rejects ?? [], x.match, x.choices ?? null, x.type]);
};

/** The confirmation to show before a change to a live question, or null when it is not live. */
function liveWarning(id: string, live: LiveIds, change: { grading: boolean; servedChange: boolean }): string | null {
  const lines: string[] = [];
  if (id === live.daily && change.servedChange) lines.push("This is today's web daily: flagging, retiring or moving it re-points the daily and DELETES today's attempts (members answer the replacement).");
  else if (id === live.daily && change.grading) lines.push("This is today's web daily: changing its answer changes how the rest of today's answers are graded.");
  if (id === live.discord && change.grading) lines.push("This question is in the open Discord round: answer changes are refused until the round closes.");
  else if (id === live.discord && change.servedChange) lines.push("This question is in the open Discord round (the round itself carries on).");
  return lines.length ? `${lines.join("\n\n")}\n\nContinue?` : null;
}

function Editor({ editing, template, live, onDone, onCancel }: { editing: Editing; template: Partial<TriviaQuestion>; live: LiveIds; onDone: (row: AdminQuestionRow) => void; onCancel: () => void }) {
  const start = editing.mode === "edit" ? ((editing.row.question ?? editing.row.data) as Partial<TriviaQuestion>) : template;
  const [form, setForm] = useState<FormState>(() => toForm(start));
  const [tab, setTab] = useState<"form" | "json">(editing.mode === "edit" && !editing.row.question ? "json" : "form");
  const [json, setJson] = useState(() => JSON.stringify(editing.mode === "edit" ? editing.row.data : fromForm(toForm(start)), null, 2));
  const [exposed, setExposed] = useState(editing.mode === "edit" ? editing.row.exposed : false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  function switchTab(next: "form" | "json") {
    setErrors([]);
    if (next === tab) return;
    if (next === "json") {
      setJson(JSON.stringify(fromForm(form), null, 2));
    } else {
      try {
        setForm(toForm(JSON.parse(json) as Partial<TriviaQuestion>));
      } catch (e) {
        setErrors([`The JSON does not parse: ${(e as Error).message}`]);
        return;
      }
    }
    setTab(next);
  }

  async function save() {
    setErrors([]);
    let question: unknown;
    if (tab === "json") {
      try {
        question = JSON.parse(json);
      } catch (e) {
        setErrors([`The JSON does not parse: ${(e as Error).message}`]);
        return;
      }
    } else question = fromForm(form);
    if (editing.mode === "edit" && question && typeof question === "object") {
      const before = (editing.row.question ?? editing.row.data ?? {}) as Partial<TriviaQuestion>;
      const after = question as Partial<TriviaQuestion>;
      const warning = liveWarning(editing.row.id, live, {
        grading: gradingKey(before) !== gradingKey(after),
        servedChange: before.status !== after.status || (before.pool ?? null) !== (after.pool ?? null),
      });
      if (warning && !window.confirm(warning)) return;
    }
    setBusy(true);
    try {
      const body =
        editing.mode === "create"
          ? { action: "create", question }
          : { action: "update", id: editing.row.id, question, expectUpdatedAt: editing.row.updatedAt, ...(exposed !== editing.row.exposed ? { exposed } : {}) };
      const res = await fetch("/api/admin/trivia/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { row?: AdminQuestionRow; error?: string; errors?: string[] };
      if (!res.ok || !out.row) {
        setErrors([out.error ?? `Could not save (${res.status})`, ...(out.errors ?? [])]);
        return;
      }
      onDone(out.row);
    } catch {
      setErrors(["Could not save. Try again."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border p-4" style={inputStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto">{editing.mode === "create" ? "New question" : `Edit ${editing.row.id}`}</strong>
        <button type="button" className={btn} style={btnStyle} onClick={() => switchTab("form")} aria-pressed={tab === "form"}>
          Form
        </button>
        <button type="button" className={btn} style={btnStyle} onClick={() => switchTab("json")} aria-pressed={tab === "json"}>
          Raw JSON
        </button>
      </div>
      {editing.mode === "edit" && editing.row.exposed && (
        <p className="m-0 text-sm text-tomato">Exposed: its answer is public (git history, or revealed by a round). Rewording the text keeps it exposed (the id is public); change the answer to a new one, or untick below, to clear it.</p>
      )}
      {tab === "json" ? (
        <Field label="Question object" hint="The full entry, exactly as stored. Validated on save.">
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={22} className={`${input} font-mono text-xs`} style={inputStyle} spellCheck={false} />
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Id" hint={editing.mode === "edit" ? "Ids never change." : "Like pd-020 (category prefix, next free number)."}>
            <input value={form.id} onChange={(e) => set("id", e.target.value)} disabled={editing.mode === "edit"} className={input} style={inputStyle} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(v) => set("category", v)} options={CATEGORIES} />
          </Field>
          <Field label="Type">
            <Select
              value={form.type}
              onChange={(v) => {
                set("type", v);
                set("matchKind", v === "true_false" ? "boolean" : v === "multiple_choice" ? "choice" : form.matchKind === "number" ? "number" : "text");
              }}
              options={QUESTION_TYPES}
            />
          </Field>
          <Field label="Difficulty">
            <Select value={form.difficulty} onChange={(v) => set("difficulty", v)} options={DIFFICULTIES} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Question">
              <textarea value={form.question} onChange={(e) => set("question", e.target.value)} rows={3} className={input} style={inputStyle} />
            </Field>
          </div>
          {form.type === "multiple_choice" && (
            <div className="sm:col-span-2">
              <Field label="Choices" hint="One per line, 2 to 4. The answer must be one of them, exactly.">
                <textarea value={form.choices} onChange={(e) => set("choices", e.target.value)} rows={4} className={input} style={inputStyle} />
              </Field>
            </div>
          )}
          <Field label="Answer" hint={form.matchKind === "boolean" ? '"true" or "false"' : form.matchKind === "number" ? "The canonical number" : undefined}>
            <input value={form.answer} onChange={(e) => set("answer", e.target.value)} className={input} style={inputStyle} />
          </Field>
          <Field label="Matcher">
            <Select value={form.matchKind} onChange={(v) => set("matchKind", v)} options={MATCH_KINDS} />
          </Field>
          {form.matchKind === "text" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.fuzzy} onChange={(e) => set("fuzzy", e.target.checked)} /> Fuzzy (typos accepted)
            </label>
          )}
          {form.matchKind === "number" && (
            <Field label="Tolerance">
              <input value={form.tolerance} onChange={(e) => set("tolerance", e.target.value)} inputMode="decimal" className={input} style={inputStyle} />
            </Field>
          )}
          <Field label="Aliases" hint="Other accepted answers, one per line.">
            <textarea value={form.aliases} onChange={(e) => set("aliases", e.target.value)} rows={3} className={input} style={inputStyle} />
          </Field>
          <Field label="Rejects" hint="Near-misses that must never pass, one per line.">
            <textarea value={form.rejects} onChange={(e) => set("rejects", e.target.value)} rows={3} className={input} style={inputStyle} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Explanation">
              <textarea value={form.explanation} onChange={(e) => set("explanation", e.target.value)} rows={2} className={input} style={inputStyle} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Sources" hint="One per line: https://url | what it shows">
              <textarea value={form.sources} onChange={(e) => set("sources", e.target.value)} rows={3} className={input} style={inputStyle} />
            </Field>
          </div>
          <Field label="Label" hint="Banner; required for just-for-fun.">
            <input value={form.label} onChange={(e) => set("label", e.target.value)} className={input} style={inputStyle} />
          </Field>
          <Field label="Valid until" hint="YYYY-MM-DD: retired at the end of that day (UTC).">
            <input value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} className={input} style={inputStyle} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => set("status", v)} options={STATUSES} />
          </Field>
          {form.status === "approved" && (
            <Field label="Pool" hint="discord: Discord rounds only. web: practice and the daily. A question keeps its pool.">
              <Select value={form.pool} onChange={(v) => set("pool", v)} options={POOLS} empty="(choose)" />
            </Field>
          )}
          {form.status === "rejected" && (
            <Field label="Why retired">
              <input value={form.rejectedReason} onChange={(e) => set("rejectedReason", e.target.value)} className={input} style={inputStyle} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Notes (admin only)">
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={input} style={inputStyle} />
            </Field>
          </div>
        </div>
      )}
      {editing.mode === "edit" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exposed} onChange={(e) => setExposed(e.target.checked)} /> Exposed (answer public). Cleared automatically only when the answer changes to a genuinely new one.
        </label>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-disc pl-5 text-sm text-tomato">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className={btn} style={btnStyle}>
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btn} style={btnStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tone === "warn" ? "border-tomato text-tomato" : ""}`} style={tone === "warn" ? undefined : inputStyle}>
      {children}
    </span>
  );
}

function RowActions({ row, live, onSaved, onEdit }: { row: AdminQuestionRow; live: LiveIds; onSaved: (row: AdminQuestionRow) => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function status(next: string, pool?: string) {
    const warning = liveWarning(row.id, live, { grading: false, servedChange: true });
    if (warning && !window.confirm(warning)) return;
    let rejectedReason: string | undefined;
    if (next === "rejected") {
      const reason = window.prompt(`Retire ${row.id}: why (who and when)?`);
      if (reason === null) return;
      rejectedReason = reason;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/trivia/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", id: row.id, status: next, pool, rejectedReason, expectUpdatedAt: row.updatedAt }),
      });
      const out = (await res.json().catch(() => ({}))) as { row?: AdminQuestionRow; error?: string; errors?: string[] };
      if (!res.ok || !out.row) setError([out.error ?? `Could not save (${res.status})`, ...(out.errors ?? [])].join(" · "));
      else onSaved(out.row);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const s = row.status;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={onEdit} disabled={busy} className={btn} style={btnStyle}>
        Edit
      </button>
      {row.question && (
        <>
          {(s !== "approved" || row.pool !== "web") && (
            <button type="button" onClick={() => status("approved", "web")} disabled={busy} className={btn} style={btnStyle}>
              {s === "approved" ? "Move to web" : "Approve (web)"}
            </button>
          )}
          {(s !== "approved" || row.pool !== "discord") && row.category !== "just-for-fun" && (
            <button type="button" onClick={() => status("approved", "discord")} disabled={busy} className={btn} style={btnStyle}>
              {s === "approved" ? "Move to discord" : "Approve (discord)"}
            </button>
          )}
          {s !== "flagged" && (
            <button type="button" onClick={() => status("flagged")} disabled={busy} className={btn} style={btnStyle}>
              Flag
            </button>
          )}
          {s !== "rejected" && (
            <button type="button" onClick={() => status("rejected")} disabled={busy} className={btn} style={btnStyle}>
              Retire
            </button>
          )}
        </>
      )}
      {error && (
        <span role="alert" className="text-sm text-tomato">
          {error}
        </span>
      )}
    </span>
  );
}

export function BankEditor({ initialRows, nextIds, live }: { initialRows: AdminQuestionRow[]; nextIds: Record<string, string>; live: LiveIds }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState("");
  const [pool, setPool] = useState("");
  const [category, setCategory] = useState("");
  const [exposed, setExposed] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newCategory, setNewCategory] = useState<string>("pizzadao");

  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!pool || (pool === "none" ? r.pool === null : r.pool === pool)) &&
        (!category || r.category === category) &&
        (!exposed || String(r.exposed) === exposed) &&
        (!needle || r.id.includes(needle) || (r.question?.question.toLowerCase().includes(needle) ?? false)),
    );
  }, [rows, status, pool, category, exposed, text]);

  function saved(row: AdminQuestionRow) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === row.id);
      const next = i < 0 ? [...rs, row] : rs.map((r) => (r.id === row.id ? row : r));
      return next.sort((a, b) => a.id.localeCompare(b.id));
    });
    setEditing(null);
    router.refresh(); // the stats above
  }

  const exposedApproved = rows.filter((r) => r.exposed && r.status === "approved").length;

  return (
    <div className="grid gap-4">
      {exposedApproved > 0 && (
        <p className="m-0 text-sm" role="status">
          <strong className="text-tomato">{exposedApproved}</strong> approved question{exposedApproved === 1 ? " is" : "s are"} exposed (answer public) and want a new answer. The daily and Discord rounds use unexposed questions first; practice serves only exposed ones.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-5">
        <Select value={status} onChange={setStatus} options={STATUSES} empty="Any status" />
        <Select value={pool} onChange={setPool} options={[...POOLS, "none"]} empty="Any pool" />
        <Select value={category} onChange={setCategory} options={CATEGORIES} empty="Any category" />
        <select value={exposed} onChange={(e) => setExposed(e.target.value)} className={input} style={inputStyle}>
          <option value="">Exposed or not</option>
          <option value="true">Exposed</option>
          <option value="false">Not exposed</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search id or text" className={input} style={inputStyle} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <span className="w-48">
          <Select value={newCategory} onChange={setNewCategory} options={CATEGORIES} />
        </span>
        <button type="button" onClick={() => setEditing({ mode: "create" })} className={btn} style={btnStyle}>
          New question ({nextIds[newCategory] ?? "?"})
        </button>
        <span className="text-sm text-foreground/70">
          Showing {shown.length} of {rows.length}
        </span>
      </div>
      {editing?.mode === "create" && (
        <Editor key={`create-${newCategory}`} editing={editing} template={{ id: nextIds[newCategory] ?? "", category: newCategory as TriviaQuestion["category"], status: "flagged" }} live={live} onDone={saved} onCancel={() => setEditing(null)} />
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {shown.map((r) => (
          <li key={r.id} className="grid gap-2 border-b border-[hsl(var(--rule-warm)/0.3)] pb-3 text-sm">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{r.id}</span>
              <Badge>{r.status}</Badge>
              {r.pool && <Badge>{r.pool}</Badge>}
              <Badge>{r.category}</Badge>
              {r.question && <Badge>{r.question.type}</Badge>}
              {r.question && <Badge>{r.question.difficulty}</Badge>}
              {r.exposed && <Badge tone="warn">exposed: needs a new answer</Badge>}
              {r.id === live.daily && <Badge tone="warn">today&apos;s web daily</Badge>}
              {r.id === live.discord && <Badge tone="warn">open Discord round</Badge>}
              {r.error && <Badge tone="warn">invalid: not served</Badge>}
              <span className="text-xs text-foreground/60">
                {r.updatedAt.slice(0, 16).replace("T", " ")} UTC{r.updatedBy ? ` · ${r.updatedBy}` : ""}
              </span>
            </p>
            {r.question ? <p className="m-0">{r.question.question}</p> : <p className="m-0 text-tomato">{r.error}</p>}
            {editing?.mode === "edit" && editing.row.id === r.id ? (
              <Editor key={`edit-${r.id}-${r.updatedAt}`} editing={editing} template={{}} live={live} onDone={saved} onCancel={() => setEditing(null)} />
            ) : (
              <RowActions row={r} live={live} onSaved={saved} onEdit={() => setEditing({ mode: "edit", row: r })} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
