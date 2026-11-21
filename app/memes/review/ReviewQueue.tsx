"use client";

// Capo / DPR review queue for the meme folder: waiting uploads first (oldest first), then reported and
// hidden memes. The API refuses anyone else with a 403, which this shows as a plain note.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, LoadingLine, paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";
import type { MemeItemDto } from "../MemeFolder";

type QueueItem = MemeItemDto & { reportCount?: number };
type Action = "approve" | "reject" | "hide" | "restore" | "clear";

export default function ReviewQueue() {
  const t = useTranslations("memes");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memes/review", { cache: "no-store" });
      if (res.status === 401 || res.status === 403 || res.status === 404) return setState("forbidden");
      if (!res.ok) return setState("error");
      setItems(((await res.json()) as { items: QueueItem[] }).items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: Action) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch("/api/memes/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, note: notes[id] ?? "" }) });
      if (!res.ok) setError(t("actionFailed"));
      await load();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy("");
    }
  }

  if (state === "loading") return <LoadingLine label={t("loading")} />;
  if (state === "forbidden") return <EmptyState title={t("reviewForbidden")} />;
  if (state === "error") return <EmptyState title={t("failed")} />;

  return (
    <div>
      <p className="mb-4">
        <Link href="/memes" className="underline">
          {t("backToFolder")}
        </Link>
      </p>
      {error && (
        <p role="alert" className="mb-4 text-sm font-semibold text-tomato-readable">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState title={t("reviewEmpty")} />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
          {items.map((m) => (
            <li key={m.id} className={`${paperCard} overflow-hidden`}>
              {m.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.caption ?? ""} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" className="block h-auto max-h-96 w-full bg-foreground/5 object-contain" />
              )}
              <div className="p-3 text-sm">
                <p className="m-0 font-semibold">
                  {t(m.status === "PENDING" ? "statusPending" : m.status === "HIDDEN" ? "statusHidden" : "statusApproved")}
                  {m.reportCount ? ` · ${t("reports", { count: m.reportCount })}` : ""}
                </p>
                {m.caption && <p className="m-0">{m.caption}</p>}
                <p className="m-0 text-muted-foreground">
                  {t("by", { name: m.uploader })} · {m.category}
                </p>
                <input
                  type="text"
                  maxLength={300}
                  placeholder={t("notePlaceholder")}
                  value={notes[m.id] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  className="mt-2 min-h-11 w-full rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.status === "PENDING" && (
                    <>
                      <button type="button" className={pillInk} disabled={busy === m.id} onClick={() => void act(m.id, "approve")}>
                        {t("approve")}
                      </button>
                      <button type="button" className={pillOutline} disabled={busy === m.id} onClick={() => void act(m.id, "reject")}>
                        {t("reject")}
                      </button>
                    </>
                  )}
                  {m.status === "APPROVED" && (
                    <>
                      <button type="button" className={pillOutline} disabled={busy === m.id} onClick={() => void act(m.id, "hide")}>
                        {t("hide")}
                      </button>
                      <button type="button" className={pillOutline} disabled={busy === m.id} onClick={() => void act(m.id, "clear")}>
                        {t("clearReports")}
                      </button>
                    </>
                  )}
                  {m.status === "HIDDEN" && (
                    <>
                      <button type="button" className={pillInk} disabled={busy === m.id} onClick={() => void act(m.id, "restore")}>
                        {t("restore")}
                      </button>
                      <button type="button" className={pillOutline} disabled={busy === m.id} onClick={() => void act(m.id, "reject")}>
                        {t("reject")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
