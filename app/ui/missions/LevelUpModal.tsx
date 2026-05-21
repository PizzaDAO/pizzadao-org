"use client";

import { btn } from "../shared-styles";

type Props = {
  level: number;
  levelTitle: string | null;
  reward: number;
  onDismiss: () => void;
};

export function LevelUpModal({ level, levelTitle, reward, onDismiss }: Props) {
  const isFinalLevel = level >= 8;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reached level ${level}`}
      onClick={onDismiss}
      data-testid="level-up-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1900,
        background: "var(--color-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "diavola-modal-fade 220ms ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: "100%",
          padding: "28px 24px",
          borderRadius: 16,
          background: "var(--color-surface)",
          color: "var(--color-text)",
          boxShadow: "var(--shadow-elevated)",
          textAlign: "center",
          display: "grid",
          gap: 14,
        }}
      >
        <div
          style={{
            fontSize: 13,
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          {isFinalLevel ? "Final Level Reached" : "Level Up!"}
        </div>

        <div
          style={{
            margin: "0 auto",
            width: 84,
            height: 84,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, var(--color-accent) 0%, #ff7a3a 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 38,
            fontWeight: 800,
            boxShadow: "var(--shadow-card)",
          }}
          aria-hidden="true"
        >
          {level}
        </div>

        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
            Level {level}
          </h2>
          {levelTitle && (
            <p style={{ margin: "4px 0 0", fontSize: 15, opacity: 0.7 }}>
              {levelTitle}
            </p>
          )}
        </div>

        {reward > 0 && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--color-surface-hover)",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            +{reward.toLocaleString()} $PEP earned
          </div>
        )}

        {isFinalLevel && (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
            You reached the top. You are a true Pizza Don.
          </p>
        )}

        <button
          onClick={onDismiss}
          style={{
            ...btn("primary"),
            justifySelf: "stretch",
            marginTop: 4,
          }}
        >
          Continue
        </button>
      </div>

      <style jsx>{`
        @keyframes diavola-modal-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
