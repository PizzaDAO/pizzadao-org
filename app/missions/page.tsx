"use client";

// capricciosa-10448 — Editorial restyle of /missions.
//
// Dossier-style page: § overline anchors, display-font level headlines with
// clamp(), butter pill for current level, paper-soft level groups with a
// halftone tint, "Filed under" wayfinding hint, handwritten margin notes on
// completed levels. Celebration loop components (MissionCompleteCelebration,
// LevelUpModal, VouchPromptCard) are touched only enough to align with the
// new dossier voice — their state machines / props are untouched.
//
// Prior history:
// - garlic-68749 (Phase 4b token migration)
// - sicilian-41551 (mobile typography clamps)

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { pageContainer, loadingSpinner } from "../ui/shared-styles";
import { MissionCard } from "../ui/missions/MissionCard";
import { MissionReviewPanel } from "../ui/missions/MissionReviewPanel";
import { MissionCompleteCelebration } from "../ui/missions/MissionCompleteCelebration";
import { LevelUpModal } from "../ui/missions/LevelUpModal";
import { VouchPromptCard } from "../ui/missions/VouchPromptCard";

type MissionData = {
  id: number;
  index: number;
  title: string;
  description: string | null;
  autoVerify: boolean;
  progress: { status: string; submittedAt: string; reviewNote?: string | null } | null;
};

type LevelData = {
  level: number;
  title: string | null;
  reward: number;
  missions: MissionData[];
};

type MissionsResponse = {
  levels: LevelData[];
  currentLevel: number;
  levelTitle: string | null;
  isAuthenticated: boolean;
};

type CelebrationState = {
  memberId: string | null;
  lastCelebratedLevel: number;
  firstMissionCelebratedAt: string | null;
  vouchPromptShownAt: string | null;
};

type Celebration =
  | { kind: "firstMission"; level: number; reward: number; levelTitle: string | null }
  | { kind: "levelUp"; level: number; reward: number; levelTitle: string | null };

const LEVEL_TITLES: Record<number, string> = {
  1: "Pizza Trainee",
  2: "Pizza Noob",
  6: "Street Muscle",
  7: "Made Mafia",
  8: "Don of Dons",
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

export default function MissionsPage() {
  const [data, setData] = useState<MissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set());

  // Celebration loop (diavola-40350)
  const [celebrationState, setCelebrationState] =
    useState<CelebrationState | null>(null);
  const [activeCelebration, setActiveCelebration] =
    useState<Celebration | null>(null);
  const [showVouchPrompt, setShowVouchPrompt] = useState(false);
  // Last seen counts to detect a freshly approved mission after submit/refresh.
  const lastApprovedCountRef = useRef<number | null>(null);

  useEffect(() => {
    fetchMissions();
    fetchCelebrationState();
  }, []);

  async function fetchMissions() {
    try {
      const res = await fetch("/api/missions", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load missions");
      const json: MissionsResponse = await res.json();

      // Snapshot approved-count BEFORE setData so the celebration trigger can
      // compare prev vs next.
      const prevApproved = lastApprovedCountRef.current;
      const nextApproved = countApproved(json);

      setData(json);
      lastApprovedCountRef.current = nextApproved;

      // Auto-expand current level
      if (json.currentLevel) {
        setExpandedLevels(new Set([json.currentLevel]));
      }

      // Trigger celebrations if conditions met
      maybeTriggerCelebration(json, prevApproved, nextApproved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchCelebrationState() {
    try {
      const res = await fetch("/api/missions/celebration", {
        cache: "no-store",
      });
      if (!res.ok) return; // unauthenticated → no celebration state
      const json: CelebrationState = await res.json();
      setCelebrationState(json);
    } catch {
      // Silent failure — celebration is non-essential
    }
  }

  function countApproved(snapshot: MissionsResponse): number {
    let n = 0;
    for (const level of snapshot.levels) {
      for (const m of level.missions) {
        if (m.progress?.status === "APPROVED") n += 1;
      }
    }
    return n;
  }

  function maybeTriggerCelebration(
    snapshot: MissionsResponse,
    prevApproved: number | null,
    nextApproved: number,
  ) {
    // Need celebration state loaded and user authenticated with a member row.
    if (!snapshot.isAuthenticated) return;
    if (!celebrationState || !celebrationState.memberId) return;
    if (activeCelebration) return; // already showing one

    const justGainedAnApproval =
      prevApproved !== null && nextApproved > prevApproved;
    const isInitialLoad = prevApproved === null;

    // Find the currently celebrated level data so we can show reward + title.
    const currentLevelData =
      snapshot.levels.find((l) => l.level === snapshot.currentLevel) ||
      snapshot.levels[snapshot.levels.length - 1];

    // CASE 1: First-ever mission completion (never celebrated before).
    if (
      !celebrationState.firstMissionCelebratedAt &&
      nextApproved > 0 &&
      (justGainedAnApproval || (isInitialLoad && nextApproved === 1))
    ) {
      setActiveCelebration({
        kind: "firstMission",
        level: snapshot.currentLevel,
        reward: currentLevelData?.reward ?? 0,
        levelTitle: currentLevelData?.title ?? snapshot.levelTitle ?? null,
      });
      // Persist server-side. Also bump lastCelebratedLevel so the level-up
      // modal does not fire on the same approval.
      persistCelebration({
        firstMissionCelebrated: true,
        lastCelebratedLevel: snapshot.currentLevel,
      });
      // Vouch prompt only shows once, after first mission, if not yet dismissed.
      if (!celebrationState.vouchPromptShownAt) {
        setShowVouchPrompt(true);
      }
      return;
    }

    // CASE 2: Level-up — currentLevel exceeds last celebrated level.
    if (snapshot.currentLevel > celebrationState.lastCelebratedLevel && justGainedAnApproval) {
      setActiveCelebration({
        kind: "levelUp",
        level: snapshot.currentLevel,
        reward: currentLevelData?.reward ?? 0,
        levelTitle: currentLevelData?.title ?? snapshot.levelTitle ?? null,
      });
      persistCelebration({ lastCelebratedLevel: snapshot.currentLevel });
    }
  }

  async function persistCelebration(patch: {
    lastCelebratedLevel?: number;
    firstMissionCelebrated?: boolean;
    vouchPromptDismissed?: boolean;
  }) {
    try {
      const res = await fetch("/api/missions/celebration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const json: CelebrationState = await res.json();
        setCelebrationState(json);
      }
    } catch {
      // Non-essential
    }
  }

  function handleCelebrationDismiss() {
    setActiveCelebration(null);
  }

  function handleVouchDismiss() {
    setShowVouchPrompt(false);
    persistCelebration({ vouchPromptDismissed: true });
  }

  function toggleLevel(level: number) {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  async function handleSubmit(missionId: number, evidence?: string, notes?: string) {
    const res = await fetch("/api/missions/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, evidence, notes }),
    });

    if (!res.ok) {
      const json = await res.json();
      alert(json.error || "Submission failed");
      throw new Error(json.error);
    }

    const result = await res.json();
    const status = result.completion?.status || "PENDING";

    // Optimistically update the UI immediately
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        levels: prev.levels.map((level) => ({
          ...level,
          missions: level.missions.map((m) =>
            m.id === missionId
              ? { ...m, progress: { status, submittedAt: new Date().toISOString() } }
              : m
          ),
        })),
      };
    });

    // Then refresh from server for accurate level/reward data
    fetchMissions();
  }

  if (loading) {
    return (
      <div
        style={{
          ...pageContainer(),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={loadingSpinner()} />
          <p
            className="overline"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            § Loading dossier…
          </p>
          <style jsx>{`
            @keyframes spin {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={pageContainer()}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div
            className="paper-soft"
            style={{
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--rule-warm) / 0.55)",
              padding: 28,
              background: "hsl(var(--cream))",
              boxShadow: "var(--shadow-soft)",
              display: "grid",
              gap: 12,
            }}
          >
            <span className="overline" style={{ color: "hsl(var(--tomato))" }}>
              § Error
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(1.75rem, 5vw, 2.25rem)",
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                lineHeight: 1.05,
              }}
            >
              The file went missing.
            </h1>
            <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
              {error || "Failed to load missions"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-pill"
              style={{
                background: "hsl(var(--ink))",
                color: "hsl(var(--cream))",
                border: "1px solid transparent",
                boxShadow: "var(--shadow-soft)",
                justifySelf: "start",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { levels, currentLevel, isAuthenticated } = data;

  return (
    <div style={pageContainer()}>
      <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 24 }}>
        {/* ─── Editorial header ──────────────────────────────────── */}
        <header
          className="fade-up"
          style={{
            display: "grid",
            gap: 14,
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              className="overline"
              style={{ color: "hsl(var(--tomato))" }}
            >
              § The Dossier · Missions
            </span>
            <Link
              href="/"
              className="overline"
              style={{
                color: "hsl(var(--muted-foreground))",
                textDecoration: "none",
                transition: "color 150ms ease",
              }}
            >
              ← Home
            </Link>
          </div>

          <h1
            style={{
              margin: 0,
              // sicilian-41551 clamp preserved, slightly tighter for editorial.
              fontSize: "clamp(2.5rem, 9vw, 4.5rem)",
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              fontFamily: DISPLAY_FONT,
              fontWeight: 900,
              color: "hsl(var(--foreground))",
              textWrap: "balance",
            }}
          >
            <span className="underline-scribble">Missions</span>{" "}
            <span style={{ color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>
              on file
            </span>
          </h1>

          <p
            style={{
              margin: 0,
              maxWidth: "44ch",
              fontSize: 16,
              lineHeight: 1.55,
              color: "hsl(var(--foreground) / 0.75)",
            }}
          >
            Complete missions to level up and earn{" "}
            <span style={{ color: "hsl(var(--tomato))", fontWeight: 700 }}>$PEP</span>{" "}
            rewards. Each one is its own little case file.
          </p>

          {/* Handwritten margin scribble — flavor, hidden on small screens. */}
          <span
            aria-hidden
            className="handwritten"
            style={{
              position: "absolute",
              right: -6,
              bottom: -18,
              transform: "rotate(-4deg)",
              fontSize: 16,
              color: "hsl(var(--tomato) / 0.8)",
              pointerEvents: "none",
              display: "none",
            }}
          />
        </header>

        {/* ─── Login prompt ──────────────────────────────────────── */}
        {!isAuthenticated && (
          <div
            className="paper-soft"
            style={{
              borderRadius: "var(--radius)",
              border: "1px dashed hsl(var(--rule-warm) / 0.7)",
              padding: 20,
              background: "hsl(var(--cream))",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: 15, color: "hsl(var(--foreground))" }}>
              <a
                href="/api/auth/discord"
                style={{
                  color: "hsl(var(--tomato))",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
                className="underline-scribble"
              >
                Log in with Discord
              </a>{" "}
              to track your progress and submit missions.
            </p>
          </div>
        )}

        {/* ─── Current Level masthead ────────────────────────────── */}
        {isAuthenticated && (
          <div
            className="paper-soft halftone-soft fade-up"
            style={{
              position: "relative",
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--rule-warm) / 0.55)",
              padding: "28px 24px",
              background:
                "linear-gradient(135deg, hsl(var(--cream-warm)) 0%, hsl(var(--butter) / 0.30) 100%)",
              boxShadow: "var(--shadow-lifted)",
              textAlign: "center",
              display: "grid",
              gap: 8,
            }}
          >
            <span
              className="overline"
              style={{ color: "hsl(var(--ink) / 0.7)" }}
            >
              § Current Level
            </span>
            <div
              style={{
                fontSize: "clamp(3rem, 12vw, 4.5rem)",
                fontWeight: 900,
                margin: 0,
                lineHeight: 0.9,
                letterSpacing: "-0.03em",
                fontFamily: DISPLAY_FONT,
                color: "hsl(var(--tomato))",
              }}
            >
              {currentLevel > 8 ? "MAX" : (
                <>
                  <span style={{ color: "hsl(var(--foreground) / 0.35)", fontWeight: 700 }}>
                    Lv.
                  </span>
                  {currentLevel}
                </>
              )}
            </div>
            {data.levelTitle && (
              <div
                style={{
                  fontSize: "clamp(1.05rem, 2.6vw, 1.35rem)",
                  fontFamily: DISPLAY_FONT,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "hsl(var(--foreground))",
                }}
              >
                <span className="circle-scribble">{data.levelTitle}</span>
              </div>
            )}
            {currentLevel > 8 && (
              <div
                className="handwritten"
                style={{
                  fontSize: 16,
                  color: "hsl(var(--ink) / 0.7)",
                  transform: "rotate(-1deg)",
                  marginTop: 8,
                }}
              >
                All levels complete — you are a true Pizza Don.
              </div>
            )}
          </div>
        )}

        {/* Vouch prompt — shown once after first-ever mission completion */}
        {isAuthenticated && showVouchPrompt && (
          <VouchPromptCard onDismiss={handleVouchDismiss} />
        )}

        {/* Admin Review Panel */}
        {isAuthenticated && <MissionReviewPanel />}

        {/* ─── Level Accordion ────────────────────────────────────
            Each level group is a "§ NN · Level X" file folder. */}
        {levels.map((levelData, idx) => {
          const isExpanded = expandedLevels.has(levelData.level);
          const isCurrentLevel = levelData.level === currentLevel;
          const isUnlocked = levelData.level <= currentLevel;
          const isComplete =
            levelData.missions.length > 0 &&
            levelData.missions.every((m) => m.progress?.status === "APPROVED");

          const completedCount = levelData.missions.filter(
            (m) => m.progress?.status === "APPROVED"
          ).length;

          const title = levelData.title || LEVEL_TITLES[levelData.level] || null;

          // Butter pill for current level; emerald complete; muted otherwise.
          const pillBg = isComplete
            ? "rgb(16, 185, 129)"
            : isCurrentLevel
              ? "hsl(var(--butter))"
              : "hsl(var(--muted))";
          const pillColor = isComplete
            ? "hsl(var(--cream))"
            : "hsl(var(--ink))";
          const pillBorder =
            isCurrentLevel && !isComplete
              ? "2px solid hsl(var(--ink))"
              : "1px solid hsl(var(--rule-warm) / 0.55)";

          const sectionNumber = `§ ${String(idx + 1).padStart(2, "0")}`;

          return (
            <div
              key={levelData.level}
              className={`paper-soft ${isCurrentLevel ? "fade-up" : ""}`}
              style={{
                position: "relative",
                borderRadius: "var(--radius)",
                border: isCurrentLevel
                  ? "1px solid hsl(var(--ink) / 0.18)"
                  : "1px solid hsl(var(--rule-warm) / 0.55)",
                background: isCurrentLevel
                  ? "hsl(var(--cream-warm))"
                  : "hsl(var(--cream))",
                boxShadow: isCurrentLevel
                  ? "var(--shadow-lifted)"
                  : "var(--shadow-soft)",
                overflow: "hidden",
              }}
            >
              {/* Folder-tab header */}
              <button
                onClick={() => toggleLevel(levelData.level)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "18px clamp(16px, 4vw, 24px)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  gap: 14,
                }}
                aria-expanded={isExpanded}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 19,
                      fontFamily: DISPLAY_FONT,
                      background: pillBg,
                      color: pillColor,
                      border: pillBorder,
                      flexShrink: 0,
                      boxShadow:
                        isCurrentLevel && !isComplete
                          ? "var(--shadow-soft)"
                          : "none",
                    }}
                    aria-hidden
                  >
                    {isComplete ? "✓" : levelData.level}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <span
                      className="overline"
                      style={{
                        color: isCurrentLevel
                          ? "hsl(var(--tomato))"
                          : "hsl(var(--muted-foreground))",
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      {sectionNumber} · Level {levelData.level}
                    </span>
                    <div
                      style={{
                        fontFamily: DISPLAY_FONT,
                        fontWeight: 800,
                        fontSize: "clamp(1.15rem, 3vw, 1.5rem)",
                        lineHeight: 1.1,
                        letterSpacing: "-0.015em",
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      {title ?? `Level ${levelData.level}`}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "hsl(var(--muted-foreground))",
                        marginTop: 4,
                      }}
                    >
                      {completedCount}/{levelData.missions.length} missions ·{" "}
                      <span style={{ color: "hsl(var(--tomato))", fontWeight: 700 }}>
                        {levelData.reward.toLocaleString()} $PEP
                      </span>
                    </div>
                  </div>
                </div>

                {/* Handwritten "complete" stamp for finished levels */}
                {isComplete && (
                  <span
                    aria-hidden
                    className="handwritten"
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 56,
                      transform: "rotate(-9deg)",
                      fontSize: 18,
                      color: "rgb(4, 120, 87)",
                      opacity: 0.85,
                      pointerEvents: "none",
                    }}
                  >
                    complete
                  </span>
                )}

                <span
                  aria-hidden
                  style={{
                    fontSize: 14,
                    color: "hsl(var(--muted-foreground))",
                    transition: "transform 220ms var(--ease-editorial)",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    flexShrink: 0,
                  }}
                >
                  ▼
                </span>
              </button>

              {/* Level Content */}
              {isExpanded && (
                <div
                  style={{
                    padding: "6px clamp(16px, 4vw, 24px) 22px",
                    display: "grid",
                    gap: 14,
                    borderTop: "1px dashed hsl(var(--rule-warm) / 0.55)",
                  }}
                >
                  {!isUnlocked && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "18px 14px",
                        fontSize: 14,
                        color: "hsl(var(--muted-foreground))",
                        fontStyle: "italic",
                      }}
                    >
                      <div
                        className="overline"
                        style={{ color: "hsl(var(--muted-foreground))", marginBottom: 6 }}
                      >
                        § Sealed
                      </div>
                      Complete Level {levelData.level - 1} to unlock these missions.
                    </div>
                  )}
                  {levelData.missions.map((mission) => (
                    <MissionCard
                      key={mission.id}
                      mission={mission}
                      levelUnlocked={isUnlocked}
                      onSubmit={handleSubmit}
                    />
                  ))}
                  {isComplete && (
                    <div
                      style={{
                        position: "relative",
                        textAlign: "center",
                        padding: "16px 16px",
                        fontFamily: DISPLAY_FONT,
                        color: "rgb(4, 120, 87)",
                        background: "rgba(16, 185, 129, 0.10)",
                        border: "1px solid rgba(16, 185, 129, 0.30)",
                        borderRadius: "var(--radius)",
                      }}
                    >
                      <div
                        className="overline"
                        style={{ color: "rgb(4, 120, 87)", marginBottom: 4 }}
                      >
                        § Closed
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>
                        Level Complete! +{levelData.reward.toLocaleString()} $PEP earned
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ─── Editorial Footer ──────────────────────────────────── */}
        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            display: "grid",
            gap: 6,
            justifyItems: "center",
          }}
        >
          <div
            className="rule-warm"
            style={{ width: 64, height: 0 }}
            aria-hidden
          />
          <span
            className="overline"
            style={{
              color: "hsl(var(--muted-foreground))",
              fontFamily: DISPLAY_FONT,
              letterSpacing: "0.32em",
            }}
          >
            § PizzaDAO Dossier
          </span>
        </div>
      </div>

      {/* ===== Celebration loop (diavola-40350) =====
          Mounted last so the overlay/modal sits above all page content.
          Editorial-ish styling lives inside the components themselves. */}
      {activeCelebration?.kind === "firstMission" && (
        <MissionCompleteCelebration
          title="Mission Complete!"
          subtitle="Your first mission is in the books."
          onDismiss={handleCelebrationDismiss}
        />
      )}
      {activeCelebration?.kind === "levelUp" && (
        <LevelUpModal
          level={activeCelebration.level}
          levelTitle={activeCelebration.levelTitle}
          reward={activeCelebration.reward}
          onDismiss={handleCelebrationDismiss}
        />
      )}
    </div>
  );
}
