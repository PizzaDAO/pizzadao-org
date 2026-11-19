"use client";

// app/admin/trivia/ReportActions.tsx
//
// One-click actions on a reported question: pull it (trivia.disabledQuestionIds, every pool) or dismiss the reports.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReportActions({ questionId, disabled }: { questionId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(action: "disable" | "enable" | "dismiss") {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/trivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, questionId }) });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const btn = "min-h-11 rounded-xl border px-4 font-semibold";
  const style = { borderColor: "hsl(var(--rule-warm) / 0.65)" };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {disabled ? (
        <button type="button" onClick={() => act("enable")} disabled={busy} className={btn} style={style}>Restore question</button>
      ) : (
        <button type="button" onClick={() => act("disable")} disabled={busy} className={btn} style={style}>Disable question</button>
      )}
      <button type="button" onClick={() => act("dismiss")} disabled={busy} className={btn} style={style}>Dismiss reports</button>
      {failed && <span role="alert" className="text-tomato text-sm">Could not save. Try again.</span>}
    </span>
  );
}
