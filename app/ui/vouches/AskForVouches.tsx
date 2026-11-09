"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ShareProfileButton } from "./ShareProfileButton";

type Candidate = { memberId: string; name: string; city: string | null };

type Props = { memberId: string };

const REASON_KEYS = ["self", "not-found", "unreachable", "already-vouched", "pending", "limit", "no-profile"] as const;

/**
 * Dashboard block: share your public profile link to ask for vouches, and (when the
 * vouches.requestsEnabled setting is on) send a request straight to a specific member.
 */
export function AskForVouches({ memberId }: Props) {
  const t = useTranslations("dashboard.vouches.ask");
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/vouches/request", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (alive) setEnabled(d?.enabled === true); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/referrals/inviters?q=${encodeURIComponent(q)}`);
        const data = res.ok ? await res.json() : { members: [] };
        if (seq === searchSeq.current) {
          setResults(((data.members ?? []) as Candidate[]).filter((m) => m.memberId !== memberId));
        }
      } catch {
        if (seq === searchSeq.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, enabled, memberId]);

  async function send(target: Candidate) {
    setSending(target.memberId);
    setMessage(null);
    try {
      const res = await fetch("/api/vouches/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberId: target.memberId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ kind: "ok", text: t("sent", { name: target.name }) });
        setQuery("");
        setResults([]);
      } else {
        const reason = String(data?.reason ?? "");
        const key = (REASON_KEYS as readonly string[]).includes(reason) ? reason : "error";
        setMessage({ kind: "error", text: key === "limit" ? t("errors.limit", { limit: Number(data?.limit ?? 0) }) : t(`errors.${key}`) });
      }
    } catch {
      setMessage({ kind: "error", text: t("errors.error") });
    } finally {
      setSending(null);
    }
  }

  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 16 }}>
      <div className="flex flex-wrap items-center gap-3">
        <ShareProfileButton
          memberId={memberId}
          label={t("share")}
          text={t("shareText")}
          copiedLabel={t("copied")}
          failedLabel={t("copyFailed")}
        />
      </div>

      {enabled && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor="vouch-request-search" className="ui text-[13px] uppercase tracking-[0.08em] text-foreground/70">
            {t("askMember")}
          </label>
          <input
            id="vouch-request-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            maxLength={60}
            style={{
              display: "block",
              width: "100%",
              maxWidth: 360,
              marginTop: 6,
              minHeight: 44,
              padding: "8px 12px",
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--rule) / 0.25)",
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
            }}
          />
          {results.length > 0 && (
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6, maxWidth: 360 }}>
              {results.map((m) => (
                <li
                  key={m.memberId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: "var(--radius)",
                    border: "1px solid hsl(var(--rule) / 0.12)",
                    background: "hsl(var(--card))",
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.name}
                    {m.city ? <span className="text-foreground/60"> · {m.city}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="btn-pill"
                    disabled={sending !== null}
                    onClick={() => send(m)}
                    style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))", border: "none", cursor: "pointer", flexShrink: 0 }}
                  >
                    {t("send")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p
            role="status"
            aria-live="polite"
            className="ui text-[13px]"
            style={{ marginTop: 8, minHeight: 18, color: message?.kind === "error" ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.8)" }}
          >
            {message?.text ?? ""}
          </p>
        </div>
      )}
    </div>
  );
}
