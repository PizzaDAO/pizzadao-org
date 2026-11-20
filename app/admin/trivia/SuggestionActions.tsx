"use client";

// app/admin/trivia/SuggestionActions.tsx
//
// One-click actions on a community suggestion: "Add to bank" (creates its draft as a flagged bank row, then marks the
// suggestion added) or dismiss it. Labels come from the server page (already translated).

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SuggestionActionLabels {
  addToBank: string;
  /** Contains "{id}". */
  addedToBank: string;
  dismiss: string;
  failed: string;
}

export function SuggestionActions({ suggestionId, canAdd, labels }: { suggestionId: number; canAdd: boolean; labels: SuggestionActionLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function act(action: "suggestion-add" | "suggestion-dismiss") {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/trivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, suggestionId }) });
      const body = (await res.json().catch(() => ({}))) as { questionId?: string; error?: string; errors?: string[] };
      if (!res.ok) {
        setNote({ kind: "error", text: [body.error ?? labels.failed, ...(body.errors ?? [])].join(" · ") });
        return;
      }
      if (action === "suggestion-add" && body.questionId) setNote({ kind: "ok", text: labels.addedToBank.replace("{id}", body.questionId) });
      router.refresh();
    } catch {
      setNote({ kind: "error", text: labels.failed });
    } finally {
      setBusy(false);
    }
  }

  const btn = "min-h-11 rounded-xl border px-4 font-semibold";
  const style = { borderColor: "hsl(var(--rule-warm) / 0.65)" };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => act("suggestion-add")} disabled={busy || !canAdd} className={btn} style={style}>
        {labels.addToBank}
      </button>
      <button type="button" onClick={() => act("suggestion-dismiss")} disabled={busy} className={btn} style={style}>
        {labels.dismiss}
      </button>
      {note && (
        <span role={note.kind === "ok" ? "status" : "alert"} className={note.kind === "ok" ? "text-sm" : "text-tomato text-sm"}>
          {note.text}
        </span>
      )}
    </span>
  );
}
