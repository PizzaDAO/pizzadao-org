"use client";

// capricciosa-10448 — Light editorial polish on the level-up modal so it
// reads as a "promotion notice" stamped into the dossier. Props, text
// ("Level X", "Continue", "Final Level Reached", "Pizza Don", "+$PEP"), and
// data-testid are unchanged — tests rely on them.
//
// Prior: diavola-40350 — level-up modal.

type Props = {
  level: number;
  levelTitle: string | null;
  reward: number;
  onDismiss: () => void;
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
        background: "hsl(var(--ink) / 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "diavola-modal-fade 220ms ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="paper-soft halftone-soft"
        style={{
          position: "relative",
          maxWidth: 440,
          width: "100%",
          padding: "30px 26px",
          borderRadius: "var(--radius)",
          border: "1px solid hsl(var(--rule-warm) / 0.55)",
          background: "hsl(var(--cream))",
          color: "hsl(var(--foreground))",
          boxShadow: "var(--shadow-lifted)",
          textAlign: "center",
          display: "grid",
          gap: 14,
        }}
      >
        {/* Handwritten "promoted" stamp */}
        <span
          aria-hidden
          className="handwritten"
          style={{
            position: "absolute",
            top: 12,
            right: 18,
            fontSize: 17,
            transform: "rotate(-7deg)",
            color: "hsl(var(--tomato))",
            opacity: 0.8,
            pointerEvents: "none",
          }}
        >
          {isFinalLevel ? "the top" : "promoted"}
        </span>

        <span
          className="overline"
          style={{
            color: "hsl(var(--tomato))",
            display: "block",
          }}
        >
          {isFinalLevel ? "§ Final Level Reached" : "§ Level Up!"}
        </span>

        <div
          style={{
            margin: "0 auto",
            width: 92,
            height: 92,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, hsl(var(--tomato)) 0%, hsl(var(--butter)) 100%)",
            color: "hsl(var(--cream))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 42,
            fontWeight: 900,
            fontFamily: DISPLAY_FONT,
            letterSpacing: "-0.02em",
            boxShadow: "var(--shadow-lifted)",
            border: "3px solid hsl(var(--cream))",
          }}
          aria-hidden="true"
        >
          {level}
        </div>

        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(1.65rem, 5vw, 2rem)",
              fontFamily: DISPLAY_FONT,
              fontWeight: 900,
              letterSpacing: "-0.015em",
              lineHeight: 1.05,
              color: "hsl(var(--foreground))",
            }}
          >
            Level {level}
          </h2>
          {levelTitle && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 15,
                fontFamily: DISPLAY_FONT,
                fontWeight: 600,
                color: "hsl(var(--foreground))",
              }}
            >
              <span className="circle-scribble">{levelTitle}</span>
            </p>
          )}
        </div>

        {reward > 0 && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius)",
              background: "hsl(var(--butter) / 0.25)",
              border: "1px solid hsl(var(--butter))",
              fontSize: 15,
              fontWeight: 800,
              fontFamily: DISPLAY_FONT,
              color: "hsl(var(--ink))",
              letterSpacing: "-0.01em",
            }}
          >
            +{reward.toLocaleString()} $PEP earned
          </div>
        )}

        {isFinalLevel && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "hsl(var(--muted-foreground))",
              lineHeight: 1.5,
            }}
          >
            You reached the top. You are a true Pizza Don.
          </p>
        )}

        <button
          onClick={onDismiss}
          className="btn-pill"
          style={{
            justifySelf: "stretch",
            marginTop: 4,
            background: "hsl(var(--ink))",
            color: "hsl(var(--cream))",
            border: "1px solid transparent",
            boxShadow: "var(--shadow-soft)",
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
