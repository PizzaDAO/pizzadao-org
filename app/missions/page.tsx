"use client";

// garlic-68749 (Restyle Phase 4b): /missions migrated onto the pizzadao.org
// design system — cream background, Asap Condensed display headings, butter
// level pills, tomato PEP accents, emerald/butter/tomato status states.
// See plans/site-restyle-pizzadao-org.md (Phase 4).
//
// MissionsProgress.tsx is OUT OF SCOPE here — Phase 3b already migrated it.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { card, btn, pageContainer, loadingSpinner } from "../ui/shared-styles";
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
          <p style={{ fontSize: 18, color: "hsl(var(--muted-foreground))" }}>
            Loading missions...
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
          <div style={card()}>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
              }}
            >
              Error
            </h1>
            <p style={{ color: "hsl(var(--muted-foreground))" }}>
              {error || "Failed to load missions"}
            </p>
            <button onClick={() => window.location.reload()} style={btn("primary")}>
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
      <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                // sicilian-41551: scale 32→44 so "Missions" doesn't dominate
                // the 375-px viewport above the fold.
                fontSize: "clamp(2rem, 7vw, 2.75rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                color: "hsl(var(--foreground))",
              }}
            >
              Missions
            </h1>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 16,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Complete missions to level up and earn $PEP rewards
            </p>
          </div>
          <Link
            href="/"
            style={{
              ...btn("secondary"),
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            &larr; Home
          </Link>
        </div>

        {/* Login prompt */}
        {!isAuthenticated && (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <a
                href="/api/auth/discord"
                style={{
                  color: "hsl(var(--tomato))",
                  fontWeight: 700,
                  textDecoration: "underline",
                }}
              >
                Log in with Discord
              </a>{" "}
              to track your progress and submit missions.
            </p>
          </div>
        )}

        {/* Current Level Banner */}
        {isAuthenticated && (
          <div
            style={{
              ...card(),
              background:
                "linear-gradient(135deg, hsl(var(--cream-warm)) 0%, hsl(var(--butter) / 0.25) 100%)",
              textAlign: "center",
              padding: 24,
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "hsl(var(--muted-foreground))",
                textTransform: "uppercase",
                letterSpacing: 1.5,
                fontWeight: 600,
              }}
            >
              Current Level
            </div>
            <div
              style={{
                // sicilian-41551: 56 → clamp so "MAX" doesn't overflow at 320–375px.
                fontSize: "clamp(2.5rem, 10vw, 3.5rem)",
                fontWeight: 800,
                margin: 0,
                lineHeight: 1,
                fontFamily: DISPLAY_FONT,
                color: "hsl(var(--tomato))",
              }}
            >
              {currentLevel > 8 ? "MAX" : currentLevel}
            </div>
            {data.levelTitle && (
              <div
                style={{
                  fontSize: 18,
                  fontFamily: DISPLAY_FONT,
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                }}
              >
                {data.levelTitle}
              </div>
            )}
            {currentLevel > 8 && (
              <div style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>
                All levels complete! You are a true Pizza Don.
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

        {/* Level Accordion */}
        {levels.map((levelData) => {
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

          // Butter pill for level number; emerald when complete; ink ring on current.
          const pillBg = isComplete
            ? "rgb(16, 185, 129)"
            : isCurrentLevel
              ? "hsl(var(--butter))"
              : "hsl(var(--muted))";
          const pillColor = isComplete
            ? "hsl(var(--cream))"
            : "hsl(var(--ink))";
          const pillBorder = isCurrentLevel && !isComplete
            ? "2px solid hsl(var(--ink))"
            : "1px solid hsl(var(--rule) / 0.22)";

          return (
            <div
              key={levelData.level}
              style={{
                ...card(),
                padding: 0,
                gap: 0,
                overflow: "hidden",
                background: isCurrentLevel
                  ? "hsl(var(--cream-warm))"
                  : "hsl(var(--card))",
              }}
            >
              {/* Level Header */}
              <button
                onClick={() => toggleLevel(levelData.level)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  // sicilian-41551: slimmer horizontal padding on phones.
                  padding: "16px clamp(14px, 4vw, 22px)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 18,
                      fontFamily: DISPLAY_FONT,
                      background: pillBg,
                      color: pillColor,
                      border: pillBorder,
                      flexShrink: 0,
                    }}
                  >
                    {isComplete ? "✓" : levelData.level}
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: DISPLAY_FONT,
                        fontWeight: 700,
                        fontSize: 20,
                        lineHeight: 1.15,
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      Level {levelData.level}
                      {title && (
                        <span
                          style={{
                            fontWeight: 500,
                            color: "hsl(var(--muted-foreground))",
                            marginLeft: 8,
                          }}
                        >
                          {title}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "hsl(var(--muted-foreground))",
                        marginTop: 2,
                      }}
                    >
                      {completedCount}/{levelData.missions.length} missions &middot;{" "}
                      <span style={{ color: "hsl(var(--tomato))", fontWeight: 700 }}>
                        {levelData.reward.toLocaleString()} $PEP
                      </span>
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 16,
                    color: "hsl(var(--muted-foreground))",
                    transition: "transform 200ms ease",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  &#9660;
                </span>
              </button>

              {/* Level Content */}
              {isExpanded && (
                <div
                  style={{
                    padding: "4px 22px 20px",
                    display: "grid",
                    gap: 10,
                    borderTop: "1px solid hsl(var(--rule) / 0.12)",
                  }}
                >
                  {!isUnlocked && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 16,
                        fontSize: 13,
                        color: "hsl(var(--muted-foreground))",
                        fontStyle: "italic",
                      }}
                    >
                      Complete Level {levelData.level - 1} to unlock these missions
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
                        textAlign: "center",
                        padding: "12px 16px",
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: DISPLAY_FONT,
                        color: "rgb(4, 120, 87)",
                        background: "rgba(16, 185, 129, 0.10)",
                        border: "1px solid rgba(16, 185, 129, 0.30)",
                        borderRadius: "var(--radius)",
                      }}
                    >
                      Level Complete! +{levelData.reward.toLocaleString()} $PEP earned
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: 13,
            marginTop: 20,
            fontFamily: DISPLAY_FONT,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          PizzaDAO
        </div>
      </div>

      {/* ===== Celebration loop (diavola-40350) =====
          Mounted last so the overlay/modal sits above all page content. */}
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
