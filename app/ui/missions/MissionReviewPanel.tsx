"use client";

// capricciosa-10448 — Editorial restyle of the admin review panel.
//
// Dossier treatment: butter-pill admin badge becomes a wax-seal-style stamp,
// each submission is a paper-soft sub-file with handwritten "for review"
// margin note. Approve / Reject CTAs become btn-pill (ink / outlined). API,
// state, and i18n unchanged.
//
// Prior: garlic-68749 (Phase 4b token migration).

import { useState, useEffect } from "react";
import Link from "next/link";
import { useToast } from "@/app/ui/shared/Toast";
import { input } from "../shared-styles";

type Submission = {
  id: number;
  missionId: number;
  discordId: string;
  memberId: string | null;
  /** Resolved server-side: Crew-sheet name, else Discord nickname / username, else the raw ID. */
  submitter?: Person;
  evidence: string | null;
  notes: string | null;
  /** Earlier rejections of this submission (it was resubmitted), oldest first. */
  reviewHistory?: string[];
  attempt?: number;
  /** MANUAL / AUTO / SEMI. */
  source?: string;
  /** Set when a verifier passed but a human must approve it (L6+, new account, previously rejected). */
  holdReason?: string | null;
  holdLabel?: string | null;
  checkResult?: Record<string, unknown> | null;
  /** What an automatic verifier saw, with role / channel / member names instead of IDs. */
  checkItems?: CheckItem[];
  /** Semi-automatic pre-checks all passed (Phase 4): offered for bulk approve. */
  allGreen?: boolean;
  /** A manual "Invite a friend": approving needs a note (who they invited). */
  noteRequired?: boolean;
  /** Possible duplicate accounts (shared wallet / X / Telegram / member ID): information only. */
  accountSignals?: AccountSignal[];
  submittedAt: string;
  mission: {
    title: string;
    level: number;
    index: number;
    description: string | null;
    verifierKey?: string | null;
  };
};

type SemiCheck = { label: string; ok: boolean | null };
type Preview = { url: string; kind: "image" | "page"; title?: string; description?: string; image?: string; siteName?: string };
type PreCheck = {
  verifier: string | null;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  checks: SemiCheck[];
  data: Record<string, unknown>;
  preview?: Preview;
};

/** A Phase 4 pre-check (semi verifier / link preview) rather than an automatic verifier's evidence. */
function asPreCheck(r: Record<string, unknown> | null | undefined): PreCheck | null {
  if (!r || !Array.isArray(r.checks) || typeof r.summary !== "string") return null;
  return r as unknown as PreCheck;
}

const httpsOnly = (u: unknown): string | null =>
  typeof u === "string" && /^https:\/\//i.test(u) ? u : null;

/** The image to show for a proof: the evidence itself, the unfurl image, a video thumbnail, the POAP / party art. */
function proofImage(sub: Submission, pre: PreCheck | null): string | null {
  if (sub.evidence && /^https:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(sub.evidence)) return sub.evidence;
  if (sub.evidence && /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//i.test(sub.evidence)) return sub.evidence;
  if (!pre) return null;
  return (
    httpsOnly(pre.data?.thumbnail) ??
    httpsOnly(pre.data?.image) ??
    httpsOnly(pre.preview?.image) ??
    (pre.preview?.kind === "image" ? httpsOnly(pre.preview.url) : null)
  );
}

const CONFIDENCE: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "All checks green", color: "rgb(4, 120, 87)", bg: "rgba(16, 185, 129, 0.10)" },
  medium: { label: "Needs your eye", color: "rgb(146, 64, 14)", bg: "rgba(245, 158, 11, 0.10)" },
  low: { label: "A check failed", color: "hsl(var(--tomato-deep))", bg: "hsl(var(--tomato) / 0.08)" },
};

function PreCheckBlock({ sub, pre }: { sub: Submission; pre: PreCheck }) {
  const conf = pre.confidence ? CONFIDENCE[pre.confidence] : null;
  const img = proofImage(sub, pre);
  const text = typeof pre.data?.text === "string" ? (pre.data.text as string) : null;
  return (
    <div
      data-testid="pre-checks"
      style={{
        fontSize: 13,
        color: "hsl(var(--foreground))",
        padding: "8px 10px",
        background: conf?.bg ?? "hsl(var(--ink) / 0.04)",
        borderLeft: `2px solid ${conf?.color ?? "hsl(var(--ink) / 0.4)"}`,
        borderRadius: 4,
        display: "grid",
        gap: 6,
      }}
    >
      <span className="overline" style={{ display: "block", color: conf?.color ?? "hsl(var(--ink) / 0.65)" }}>
        § {pre.verifier ? "Pre-checks" : "Link preview"}
        {conf ? ` · ${conf.label}` : ""}
      </span>
      {pre.verifier && <div style={{ fontWeight: 600 }}>{pre.summary}</div>}
      {pre.checks.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 2 }}>
          {pre.checks.map((c, i) => (
            <li key={i} style={{ wordBreak: "break-word" }}>
              <span aria-hidden style={{ marginRight: 6 }}>{c.ok === true ? "✅" : c.ok === false ? "❌" : "👀"}</span>
              {c.label}
            </li>
          ))}
        </ul>
      )}
      {text && (
        <blockquote style={{ margin: 0, paddingLeft: 8, borderLeft: "2px solid hsl(var(--rule-warm))", color: "hsl(var(--muted-foreground))" }}>
          {text}
        </blockquote>
      )}
      {(img || pre.preview?.title) && (
        <a
          href={httpsOnly(pre.preview?.url) ?? httpsOnly(pre.data?.url) ?? sub.evidence ?? "#"}
          target="_blank"
          rel="noreferrer noopener"
          style={{ display: "flex", gap: 10, alignItems: "flex-start", textDecoration: "none", color: "inherit" }}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element -- third-party proof image, any host
            <img
              src={img}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              style={{ width: 120, maxHeight: 90, objectFit: "cover", borderRadius: 4, flexShrink: 0, background: "hsl(var(--ink) / 0.06)" }}
            />
          )}
          {pre.preview?.title && (
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600 }}>{pre.preview.title}</span>
              {pre.preview.description && (
                <span style={{ display: "block", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  {pre.preview.description.slice(0, 160)}
                </span>
              )}
              {pre.preview.siteName && (
                <span style={{ display: "block", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{pre.preview.siteName}</span>
              )}
            </span>
          )}
        </a>
      )}
    </div>
  );
}

type Person = { name: string; discordId: string; memberId?: string; handle?: string; avatarUrl?: string };
type CheckItem = { label: string; value: string; href?: string };

type AccountSignal = { kind: string; label: string; key: string; others: string[]; othersLabeled?: Person[] };

type FlaggedCompletion = {
  id: number;
  discordId: string;
  member?: Person;
  flaggedAt: string;
  flagReason: string | null;
  mission: { title: string; level: number; index: number };
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

const personOf = (sub: Submission): Person => sub.submitter ?? { name: sub.discordId, discordId: sub.discordId };

/** "member #N" when they're in the Crew sheet, else their Discord handle. */
const personHint = (p: Person): string | null => (p.memberId ? `member #${p.memberId}` : p.handle ?? null);

/** A name (linked to the profile when there's a member ID) plus a small muted hint. */
function PersonName({ person, strong = true }: { person: Person; strong?: boolean }) {
  const hint = personHint(person);
  const nameStyle = { fontWeight: strong ? 600 : 400, color: "hsl(var(--foreground))" } as const;
  return (
    <span title={`Discord ${person.discordId}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {person.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- Discord CDN avatar
        <img src={person.avatarUrl} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" style={{ borderRadius: 999 }} />
      )}
      {person.memberId ? (
        <Link href={`/profile/${person.memberId}`} style={{ ...nameStyle, textDecoration: "underline", textDecorationColor: "hsl(var(--rule-warm))" }}>
          {person.name}
        </Link>
      ) : (
        <span style={nameStyle}>{person.name}</span>
      )}
      {hint && <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", opacity: 0.85 }}>{hint}</span>}
    </span>
  );
}

export function MissionReviewPanel() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [flagged, setFlagged] = useState<FlaggedCompletion[]>([]);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    fetchPending();
  }, []);

  async function fetchPending() {
    try {
      setLoading(true);
      const res = await fetch("/api/missions/pending");
      if (!res.ok) {
        if (res.status === 403) {
          setError("admin-only");
          return;
        }
        throw new Error("Failed to fetch");
      }
      const json = await res.json();
      setSubmissions(json.submissions);
      setFlagged(json.flagged ?? []);
    } catch {
      setError("Failed to load pending submissions");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(completionId: number, action: "approve" | "reject") {
    setProcessing((prev) => new Set(prev).add(completionId));
    try {
      const res = await fetch("/api/missions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completionId,
          action,
          reviewNote: reviewNotes[completionId] || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        toast.error(json.error || "Review failed");
        return;
      }

      // Remove from list
      setSubmissions((prev) => prev.filter((s) => s.id !== completionId));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(completionId);
        return next;
      });
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(completionId);
        return next;
      });
    }
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkApprove() {
    const ids = submissions.filter((s) => selected.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/missions/review/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionIds: ids, reviewNote: bulkNote.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Bulk approve failed");
        return;
      }
      const results: Array<{ id: number; outcome: string }> = json.results ?? [];
      const gone = new Set(results.filter((r) => r.outcome === "approved" || r.outcome === "already_handled" || r.outcome === "not_found").map((r) => r.id));
      setSubmissions((prev) => prev.filter((s) => !gone.has(s.id)));
      setSelected(new Set());
      const approved = results.filter((r) => r.outcome === "approved").length;
      const skipped = results.length - approved;
      if (skipped) toast.error(`Approved ${approved}; ${skipped} skipped (already handled, needs a note, or not yours to review).`);
      else toast.success(`Approved ${approved}.`);
    } finally {
      setBulkBusy(false);
    }
  }

  // Hide entirely for non-admins (API 403).
  if (error === "admin-only") return null;
  // No flash of empty state during the initial fetch.
  if (loading) return null;

  return (
    <div
      className="paper-soft halftone-soft fade-up"
      style={{
        position: "relative",
        border: "2px solid hsl(var(--butter))",
        borderRadius: "var(--radius)",
        padding: "22px clamp(18px, 4vw, 26px)",
        boxShadow: "var(--shadow-lifted)",
        background:
          "linear-gradient(180deg, hsl(var(--cream-warm)) 0%, hsl(var(--cream)) 100%)",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 18,
      }}
    >
      {/* Wax-seal style "ADMIN" stamp */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 16px",
            borderRadius: 999,
            background: "hsl(var(--ink))",
            color: "hsl(var(--butter))",
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            transform: "rotate(-2deg)",
            boxShadow: "var(--shadow-soft)",
            border: "2px solid hsl(var(--butter))",
          }}
          aria-hidden
        >
          ★ Admin Only ★
        </span>
        <div>
          <span
            className="overline"
            style={{ color: "hsl(var(--muted-foreground))", display: "block" }}
          >
            § Pending Reviews
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "clamp(1.35rem, 3vw, 1.75rem)",
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
              color: "hsl(var(--foreground))",
            }}
          >
            <span style={{ color: "hsl(var(--tomato))" }}>{submissions.length}</span>{" "}
            on your desk
          </h3>
        </div>
      </div>

      {submissions.length > 0 && (
        <div
          data-testid="bulk-approve"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: "var(--radius)",
            border: "1px dashed hsl(var(--rule-warm) / 0.75)",
            background: "hsl(var(--cream))",
            fontSize: 13,
          }}
        >
          <button
            type="button"
            className="btn-pill"
            onClick={() => setSelected(new Set(submissions.filter((s) => s.allGreen).map((s) => s.id)))}
            disabled={!submissions.some((s) => s.allGreen)}
            style={{ fontSize: 12, padding: "0.4rem 0.9rem", background: "transparent", border: "1px solid hsl(var(--rule-warm) / 0.7)", color: "hsl(var(--foreground))" }}
          >
            Select all green ({submissions.filter((s) => s.allGreen).length})
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{ fontSize: 12, background: "none", border: "none", color: "hsl(var(--muted-foreground))", textDecoration: "underline", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
          <input
            type="text"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Note for all (optional)"
            style={{ ...input(), fontSize: 12, flex: 1, minWidth: 140 }}
          />
          <button
            type="button"
            className="btn-pill"
            onClick={handleBulkApprove}
            disabled={selected.size === 0 || bulkBusy}
            style={{
              fontSize: 12,
              padding: "0.45rem 1rem",
              background: "hsl(var(--ink))",
              color: "hsl(var(--cream))",
              border: "1px solid transparent",
              opacity: selected.size === 0 || bulkBusy ? 0.5 : 1,
              cursor: selected.size === 0 || bulkBusy ? "not-allowed" : "pointer",
            }}
          >
            {bulkBusy ? "Approving…" : `Approve selected (${selected.size})`}
          </button>
        </div>
      )}

      {submissions.length === 0 ? (
        <div
          style={{
            position: "relative",
            padding: "28px clamp(18px, 4vw, 26px)",
            borderRadius: "var(--radius)",
            border: "1px dashed hsl(var(--rule-warm) / 0.75)",
            background: "hsl(var(--cream))",
            display: "grid",
            gap: 8,
            placeItems: "center",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden
            className="handwritten"
            style={{
              position: "absolute",
              top: 4,
              right: 14,
              fontSize: 13,
              transform: "rotate(-7deg)",
              color: "hsl(var(--tomato) / 0.75)",
              pointerEvents: "none",
            }}
          >
            the kitchen is quiet
          </span>
          <span
            className="overline"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            § Empty queue
          </span>
          <p
            style={{
              margin: 0,
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: "clamp(1.15rem, 2.6vw, 1.4rem)",
              lineHeight: 1.1,
              color: "hsl(var(--foreground))",
            }}
          >
            All caught up.
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "hsl(var(--muted-foreground))",
              maxWidth: "44ch",
            }}
          >
            No pending submissions on the desk. Check back later when members
            file new dossiers for review.
          </p>
        </div>
      ) : (
      <div style={{ display: "grid", gap: 14 }}>
        {submissions.map((sub, idx) => {
          // Mild deterministic tilt per submission, like loose pages on a desk.
          const tilt = ((sub.id % 2 === 0 ? -1 : 1) * (0.3 + (sub.id % 3) * 0.12)).toFixed(2);
          return (
            <div
              key={sub.id}
              className="paper-soft"
              style={{
                position: "relative",
                padding: "16px 18px",
                borderRadius: "var(--radius)",
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                background: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
                display: "grid",
                gap: 12,
                transform: `rotate(${tilt}deg)`,
              }}
            >
              {/* Handwritten "for review" margin note */}
              <span
                aria-hidden
                className="handwritten"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 12,
                  fontSize: 13,
                  transform: "rotate(-7deg)",
                  color: "hsl(var(--tomato) / 0.75)",
                  pointerEvents: "none",
                }}
              >
                for review
              </span>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${sub.mission.title} by ${personOf(sub).name} for bulk approve`}
                  checked={selected.has(sub.id)}
                  onChange={() => toggleSelected(sub.id)}
                  style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span
                    className="overline"
                    style={{
                      color: "hsl(var(--muted-foreground))",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    § FILE {String(idx + 1).padStart(2, "0")} · Lv.{sub.mission.level}
                  </span>
                  <div
                    style={{
                      fontFamily: DISPLAY_FONT,
                      fontWeight: 800,
                      fontSize: "clamp(1rem, 2.2vw, 1.15rem)",
                      lineHeight: 1.2,
                      letterSpacing: "-0.01em",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {sub.mission.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "hsl(var(--muted-foreground))",
                      marginTop: 4,
                    }}
                  >
                    submitted by{" "}
                    <span data-testid="submitter">
                      <PersonName person={personOf(sub)} />
                    </span>{" "}
                    ·{" "}
                    {new Date(sub.submittedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>

              {sub.evidence && (
                <div
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "hsl(var(--butter) / 0.12)",
                    borderLeft: "2px solid hsl(var(--butter))",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{
                      display: "block",
                      marginBottom: 2,
                      color: "hsl(var(--ink) / 0.65)",
                    }}
                  >
                    § Evidence
                  </span>
                  {sub.evidence.startsWith("http") ? (
                    <a
                      href={sub.evidence}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "hsl(var(--tomato))",
                        textDecoration: "underline",
                        wordBreak: "break-all",
                      }}
                    >
                      {sub.evidence}
                    </a>
                  ) : (
                    sub.evidence
                  )}
                </div>
              )}

              {(() => {
                const pre = asPreCheck(sub.checkResult);
                if (pre && !sub.holdReason) return <PreCheckBlock sub={sub} pre={pre} />;
                const img = !sub.holdReason ? proofImage(sub, null) : null;
                return img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- member-uploaded proof image
                  <img src={img} alt="Proof" referrerPolicy="no-referrer" loading="lazy" style={{ maxWidth: 240, maxHeight: 180, borderRadius: 4, objectFit: "contain" }} />
                ) : null;
              })()}

              {sub.holdReason && (
                <div
                  data-testid="awaiting-release"
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "rgba(16, 185, 129, 0.08)",
                    borderLeft: "2px solid rgb(16, 185, 129)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{ display: "block", marginBottom: 2, color: "rgb(4, 120, 87)" }}
                  >
                    § Auto-verified · needs approval
                  </span>
                  {sub.holdLabel ?? sub.holdReason}
                  {sub.checkItems && sub.checkItems.length > 0 && (
                    <div data-testid="verifier-saw" style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4, wordBreak: "break-word" }}>
                      Verifier saw:{" "}
                      {sub.checkItems.map((c, i) => (
                        <span key={`${c.label}-${i}`}>
                          {i > 0 && " · "}
                          {c.label}:{" "}
                          {c.href ? (
                            <a href={c.href} target="_blank" rel="noreferrer noopener" style={{ color: "inherit", textDecoration: "underline" }}>
                              {c.value}
                            </a>
                          ) : (
                            <span style={{ color: "hsl(var(--foreground))" }}>{c.value}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {sub.accountSignals && sub.accountSignals.length > 0 && (
                <div
                  data-testid="account-signals"
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "rgba(245, 158, 11, 0.08)",
                    borderLeft: "2px solid rgb(245, 158, 11)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{ display: "block", marginBottom: 2, color: "rgb(180, 83, 9)" }}
                  >
                    § Possible duplicate account · check before approving
                  </span>
                  {sub.accountSignals.map((sig) => (
                    <div key={`${sig.kind}:${sig.key}`} style={{ wordBreak: "break-word" }}>
                      {sig.label}{" "}
                      {(sig.othersLabeled ?? sig.others.map((d) => ({ name: d, discordId: d }))).map((p, i) => (
                        <span key={p.discordId}>
                          {i > 0 && ", "}
                          <PersonName person={p} strong={false} />
                        </span>
                      ))}{" "}
                      ({sig.key})
                    </div>
                  ))}
                </div>
              )}

              {sub.notes && (
                <div
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "hsl(var(--ink) / 0.04)",
                    borderLeft: "2px solid hsl(var(--ink) / 0.4)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{
                      display: "block",
                      marginBottom: 2,
                      color: "hsl(var(--ink) / 0.65)",
                    }}
                  >
                    § Notes
                  </span>
                  {sub.notes}
                </div>
              )}

              {sub.reviewHistory && sub.reviewHistory.length > 0 && (
                <div
                  data-testid="review-history"
                  style={{
                    fontSize: 12,
                    color: "hsl(var(--tomato-deep))",
                    padding: "8px 10px",
                    background: "hsl(var(--tomato) / 0.05)",
                    borderLeft: "2px solid hsl(var(--tomato))",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{ display: "block", marginBottom: 2, color: "hsl(var(--tomato-deep))" }}
                  >
                    § Resubmission — attempt {sub.attempt ?? sub.reviewHistory.length + 1}
                  </span>
                  <ul style={{ margin: 0, paddingLeft: 16, wordBreak: "break-word" }}>
                    {sub.reviewHistory.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: 4,
                  paddingTop: 10,
                  borderTop: "1px dashed hsl(var(--rule-warm) / 0.55)",
                }}
              >
                <input
                  type="text"
                  value={reviewNotes[sub.id] || ""}
                  onChange={(e) =>
                    setReviewNotes((prev) => ({ ...prev, [sub.id]: e.target.value }))
                  }
                  placeholder={sub.noteRequired ? "Who did they invite? (note required)" : "Review note (optional)"}
                  style={{ ...input(), fontSize: 13, flex: 1, minWidth: 160 }}
                />
                <button
                  onClick={() => handleReview(sub.id, "approve")}
                  disabled={processing.has(sub.id) || (!!sub.noteRequired && (reviewNotes[sub.id] ?? "").trim().length < 3)}
                  title={sub.noteRequired ? "Add a note: who did they invite?" : undefined}
                  className="btn-pill"
                  style={{
                    fontSize: 13,
                    padding: "0.55rem 1.15rem",
                    background: "hsl(var(--ink))",
                    color: "hsl(var(--cream))",
                    border: "1px solid transparent",
                    boxShadow: "var(--shadow-soft)",
                    opacity: processing.has(sub.id) ? 0.6 : 1,
                    cursor: processing.has(sub.id) ? "not-allowed" : "pointer",
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReview(sub.id, "reject")}
                  disabled={processing.has(sub.id)}
                  className="btn-pill"
                  style={{
                    fontSize: 13,
                    padding: "0.55rem 1.15rem",
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--rule-warm) / 0.7)",
                    opacity: processing.has(sub.id) ? 0.6 : 1,
                    cursor: processing.has(sub.id) ? "not-allowed" : "pointer",
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {flagged.length > 0 && (
        <div data-testid="flagged-completions" style={{ marginTop: 22 }}>
          <span className="overline" style={{ display: "block", marginBottom: 6, color: "rgb(180, 83, 9)" }}>
            § Flagged · approved, but no longer met (nothing was taken back)
          </span>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "hsl(var(--foreground))" }}>
            {flagged.map((f) => (
              <li key={f.id} style={{ wordBreak: "break-word" }}>
                L{f.mission.level}.{f.mission.index} {f.mission.title} ·{" "}
                <PersonName person={f.member ?? { name: f.discordId, discordId: f.discordId }} strong={false} />
                {f.flagReason ? ` · ${f.flagReason}` : ""} · {new Date(f.flaggedAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
