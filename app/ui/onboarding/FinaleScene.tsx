// app/ui/onboarding/FinaleScene.tsx
// pizzaiolo-35410 — animated finale that plays after wizard submit succeeds.
//
// Ports the 6-phase ceremony from the editorial mockup
// (src/pages/MafiaNamePage.tsx → FinaleScene). Phase timing mirrors the
// reference so the vignette, seal, "made" overline, name, descriptor, and
// CTAs land in the same cinematic rhythm.
//
// Respects prefers-reduced-motion: with reduced motion all phases jump to
// their final state on first render, no transitions, no animation.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

// --- Archive number ---------------------------------------------------------
// Deterministic per-name + per-day, matching the mockup's familyArchiveNo.
// Stable across re-renders within a session so the dossier feels minted, not
// shuffled.
function familyArchiveNo(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const n = (Math.abs(h) % 90000) + 10000;
  return n.toString();
}

// --- Reduced-motion detection ----------------------------------------------
// Run-time check so we can skip the staggered timeouts entirely and render
// the dossier in its final state on mount.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

// --- Phase scheduler --------------------------------------------------------
// Phases mirror the mockup:
//   1 (200ms)  vignette darkens
//   2 (700ms)  seal stamp appears
//   3 (1300ms) "you've been made" overline fades in
//   4 (1900ms) name reveals (blur + lift)
//   5 (2500ms) descriptor + dossier fields fade in
//   6 (3100ms) CTAs lift into place
const PHASE_TIMINGS = [200, 700, 1300, 1900, 2500, 3100];

type Props = {
  mafiaName: string;
  memberId?: string;
  dashboardHref: string;
};

export function FinaleScene({ mafiaName, memberId, dashboardHref }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<number>(reducedMotion ? 6 : 0);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // Stable archive number, scoped to the name + today's date.
  const archiveNo = useMemo(
    () => familyArchiveNo(`${mafiaName}::${new Date().toDateString()}`),
    [mafiaName],
  );

  // Phase sequencing — fire once on mount, then never again. Cleanup clears
  // any timers if the user navigates away mid-animation.
  useEffect(() => {
    if (reducedMotion) {
      setPhase(6);
      return;
    }
    const timers = PHASE_TIMINGS.map((delay, i) =>
      window.setTimeout(() => setPhase(i + 1), delay),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [reducedMotion]);

  // --- Share action -------------------------------------------------------
  // Tries the native share sheet first (mobile), falls back to clipboard.
  const shareUrlRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    shareUrlRef.current = window.location.origin + dashboardHref;
  }, [dashboardHref]);

  const handleShare = async () => {
    const url = shareUrlRef.current || dashboardHref;
    const text = `I just got made in PizzaDAO. My name is ${mafiaName}.`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: mafiaName, text, url });
        return;
      }
    } catch {
      // user cancelled — fall through to clipboard fallback
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShareToast("Copied — paste it anywhere.");
        window.setTimeout(() => setShareToast(null), 2400);
        return;
      }
    } catch {
      // ignore — final fallback below
    }
    setShareToast("Sharing isn't available here.");
    window.setTimeout(() => setShareToast(null), 2400);
  };

  // --- Inline styles -------------------------------------------------------
  // The scene paints over the wizard card so it needs to claim the viewport
  // with a fixed overlay. Using inline styles keeps it self-contained — no
  // dependency on global selectors that might not exist outside /join.
  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "hsl(var(--background))",
    overflow: "auto",
  };
  const vignette: CSSProperties = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    transition: "opacity 700ms var(--ease-filmic)",
    opacity: phase >= 1 ? 1 : 0,
    background:
      "radial-gradient(70% 60% at 50% 40%, transparent 30%, hsl(20 25% 8% / 0.55) 100%)",
  };
  const dossier: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    borderRadius: 22,
    border: "1px solid hsl(var(--rule-warm) / 0.55)",
    background: "hsl(var(--card))",
    padding: "clamp(20px, 4vw, 36px)",
    boxShadow: "var(--shadow-lifted)",
    transform: "rotate(-0.4deg)",
  };

  const transition = (ms = 700): CSSProperties => ({
    transition: `opacity ${ms}ms var(--ease-editorial), transform ${ms}ms var(--ease-editorial), filter ${ms}ms var(--ease-editorial)`,
  });

  return (
    <section style={overlay} aria-live="polite">
      {/* Cinematic vignette — Phase 1 */}
      <div aria-hidden style={vignette} />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 720,
          margin: "0 auto",
          padding: "clamp(24px, 6vw, 56px) 16px",
        }}
      >
        <div className="paper-soft" style={dossier}>
          {/* Top strip — "PizzaDAO · Family Record · № archive" */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 12,
              paddingBottom: 10,
              ...transition(500),
              opacity: phase >= 2 ? 1 : 0,
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 12,
                height: 20,
                flexShrink: 0,
                borderRadius: 999,
                border: "2px solid hsl(var(--foreground) / 0.45)",
                borderBottomColor: "transparent",
                transform: "rotate(-12deg)",
              }}
            />
            <p
              className="overline"
              style={{
                flex: 1,
                minWidth: 0,
                color: "hsl(var(--foreground) / 0.6)",
                letterSpacing: "0.32em",
              }}
            >
              PizzaDAO · Family Record
            </p>
            <p
              className="overline"
              style={{
                flexShrink: 0,
                color: "hsl(var(--foreground) / 0.55)",
                letterSpacing: "0.32em",
              }}
            >
              № {archiveNo}
            </p>
          </div>
          <div
            style={{
              height: 1,
              background: "hsl(var(--foreground) / 0.18)",
              marginBottom: 24,
            }}
          />

          {/* Main body — seal + name reveal */}
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "minmax(96px, 132px) 1fr",
              gap: "clamp(18px, 3vw, 32px)",
              alignItems: "center",
            }}
          >
            {/* Phase 2 — circular seal stamp */}
            <div
              aria-hidden
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                width: "100%",
                borderRadius: "48% 52% 53% 47% / 51% 48% 52% 49%",
                border: "3px solid hsl(var(--tomato) / 0.85)",
                background:
                  "radial-gradient(60% 60% at 32% 28%, hsl(var(--tomato) / 0.22), transparent 70%), radial-gradient(40% 40% at 75% 75%, hsl(var(--tomato-deep) / 0.18), transparent 70%), hsl(var(--card))",
                boxShadow:
                  "inset 0 0 0 2px hsl(var(--tomato) / 0.28), inset 0 6px 14px -6px hsl(var(--tomato-deep) / 0.5), 0 16px 28px -14px hsl(20 30% 10% / 0.45)",
                display: "grid",
                placeItems: "center",
                color: "hsl(var(--tomato))",
                transform: phase >= 2 ? "rotate(-11deg) scale(1)" : "scale(0.6)",
                opacity: phase >= 2 ? 1 : 0,
                ...transition(700),
                filter: "contrast(1.06) saturate(1.04)",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  lineHeight: 1.05,
                  position: "relative",
                  zIndex: 1,
                  padding: 6,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display), system-ui, sans-serif",
                    fontWeight: 900,
                    textTransform: "uppercase",
                    fontSize: "clamp(9px, 1.2vw, 12px)",
                    letterSpacing: "0.18em",
                  }}
                >
                  Officially
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display), system-ui, sans-serif",
                    fontWeight: 900,
                    textTransform: "uppercase",
                    fontSize: "clamp(14px, 2vw, 20px)",
                    letterSpacing: "0.12em",
                  }}
                >
                  Made
                </div>
                <div
                  className="overline"
                  style={{
                    marginTop: 4,
                    fontSize: 8,
                    letterSpacing: "0.32em",
                    opacity: 0.8,
                  }}
                >
                  PizzaDAO
                </div>
              </div>
            </div>

            {/* Right column — phases 3/4/5 */}
            <div style={{ minWidth: 0 }}>
              {/* Phase 3 — "Status · Made" overline */}
              <p
                className="overline"
                style={{
                  color: "hsl(var(--tomato))",
                  letterSpacing: "0.32em",
                  ...transition(500),
                  opacity: phase >= 3 ? 1 : 0,
                }}
              >
                Status · Made
              </p>

              {/* Phase 4 — name reveal */}
              <h1
                style={{
                  fontFamily: "var(--font-display), system-ui, sans-serif",
                  fontWeight: 900,
                  margin: "10px 0 0",
                  fontSize: "clamp(1.8rem, 5vw, 3.2rem)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.015em",
                  color: "hsl(var(--foreground))",
                  textWrap: "balance" as CSSProperties["textWrap"],
                  ...transition(700),
                  transform: phase >= 4 ? "translateY(0)" : "translateY(12px)",
                  filter: phase >= 4 ? "blur(0)" : "blur(6px)",
                  opacity: phase >= 4 ? 1 : 0,
                }}
              >
                {mafiaName}
              </h1>

              {/* Phase 5 — handwritten "approved" margin note */}
              <span
                aria-hidden
                className="handwritten"
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  transform: "rotate(-3deg)",
                  fontSize: 15,
                  color: "hsl(var(--tomato))",
                  ...transition(500),
                  opacity: phase >= 5 ? 1 : 0,
                }}
              >
                approved — the family
              </span>

              {/* Phase 5 — "you've been made" descriptor */}
              <p
                style={{
                  marginTop: 12,
                  maxWidth: "44ch",
                  fontSize: "clamp(13.5px, 1.4vw, 16px)",
                  fontStyle: "italic",
                  lineHeight: 1.4,
                  color: "hsl(var(--foreground) / 0.75)",
                  ...transition(700),
                  opacity: phase >= 5 ? 1 : 0,
                }}
              >
                "You've been made. The record is sealed."
              </p>
            </div>
          </div>

          {/* Phase 5 — dossier metadata fields */}
          <div
            style={{
              position: "relative",
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "10px 22px",
              borderTop: "1px solid hsl(var(--foreground) / 0.15)",
              paddingTop: 16,
              ...transition(700),
              opacity: phase >= 5 ? 1 : 0,
            }}
          >
            <DossierField label="Status" value="Made" />
            <DossierField label="Archive" value={`№ ${archiveNo}`} />
            <DossierField
              label="Initiated"
              value={new Date().toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            />
            {memberId && <DossierField label="Member" value={`№ ${memberId}`} />}
          </div>
        </div>

        {/* Phase 6 — CTAs */}
        <div
          style={{
            marginTop: 32,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "center",
            ...transition(500),
            transform: phase >= 6 ? "translateY(0)" : "translateY(8px)",
            opacity: phase >= 6 ? 1 : 0,
          }}
        >
          <a
            href={dashboardHref}
            className="btn-pill-lg"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              border: "1px solid hsl(var(--tomato))",
              textDecoration: "none",
            }}
          >
            Continue to dashboard
          </a>
          <button
            type="button"
            onClick={handleShare}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.3)",
              cursor: "pointer",
            }}
          >
            Share my name
          </button>
        </div>

        {/* Tiny editorial footnote — fades in last alongside CTAs */}
        <p
          className="overline"
          style={{
            textAlign: "center",
            marginTop: 18,
            color: "hsl(var(--foreground) / 0.45)",
            ...transition(500),
            opacity: phase >= 6 ? 1 : 0,
          }}
        >
          § Filed in the family record · {new Date().getFullYear()}
        </p>

        {shareToast && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "fixed",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 16px",
              borderRadius: 999,
              background: "hsl(var(--foreground))",
              color: "hsl(var(--background))",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "var(--shadow-lifted)",
              zIndex: 60,
            }}
          >
            {shareToast}
          </div>
        )}
      </div>
    </section>
  );
}

function DossierField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="overline"
        style={{
          fontSize: 9,
          letterSpacing: "0.3em",
          color: "hsl(var(--foreground) / 0.45)",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-display), system-ui, sans-serif",
          fontWeight: 900,
          marginTop: 6,
          fontSize: 15,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          color: "hsl(var(--foreground))",
        }}
      >
        {value}
      </p>
    </div>
  );
}
