"use client";

// app/admin/trivia/SuggestionActions.tsx
//
// One-click actions on a community suggestion: copy its JSON snippet (a draft entry in the data/trivia/questions.json
// schema, to paste into a PR), mark it added, or dismiss it. Labels come from the server page (already translated).

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SuggestionActionLabels {
  copy: string;
  copied: string;
  copyFailed: string;
  added: string;
  dismiss: string;
  failed: string;
}

export function SuggestionActions({ suggestionId, snippet, labels }: { suggestionId: number; snippet: string | null; labels: SuggestionActionLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"" | "copied" | "copyFailed" | "failed">("");

  async function copy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setNote("copied");
    } catch {
      setNote("copyFailed");
    }
  }

  async function close(action: "suggestion-added" | "suggestion-dismiss") {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/admin/trivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, suggestionId }) });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  }

  const btn = "min-h-11 rounded-xl border px-4 font-semibold";
  const style = { borderColor: "hsl(var(--rule-warm) / 0.65)" };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} disabled={!snippet} className={btn} style={style}>
        {labels.copy}
      </button>
      <button type="button" onClick={() => close("suggestion-added")} disabled={busy} className={btn} style={style}>
        {labels.added}
      </button>
      <button type="button" onClick={() => close("suggestion-dismiss")} disabled={busy} className={btn} style={style}>
        {labels.dismiss}
      </button>
      {note && (
        <span role={note === "copied" ? "status" : "alert"} className={note === "copied" ? "text-sm" : "text-tomato text-sm"}>
          {note === "copied" ? labels.copied : note === "copyFailed" ? labels.copyFailed : labels.failed}
        </span>
      )}
    </span>
  );
}
