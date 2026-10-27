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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { originLine, type NameOriginWithFilm } from "@/app/lib/name-origin";

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

// AI portrait (plans/mafia-name-port.md, Phase 1). Generation takes ~5-15s, so
// the scene never waits on it: the seal shows its text until the portrait lands.
const PORTRAIT_CLIENT_TIMEOUT_MS = 50_000;

type Portrait = {
  url: string | null;
  loading: boolean;
  /** Set when the last attempt failed or hit the limit; the previous url (if any) stays on screen. */
  notice: "unavailable" | "limited" | null;
  /** Draws left today, known once the server has told us. */
  remaining: number | null;
  variant: number;
};

// "Name Here" -> "Name_Here" for download filenames.
function fileSafe(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "mafia";
}

// Clipboard image writes only reliably accept PNG, and the portrait is WebP.
async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"),
  );
}

type Props = {
  mafiaName: string;
  memberId?: string;
  dashboardHref: string;
  topping?: string;
  // Recorded with the claim behind the public /made/[id] page.
  filmId?: string;
  filmTitle?: string;
  tmdbMovieId?: string;
  origin?: NameOriginWithFilm;
  /** namegen's signature for the picked suggestion; absent for typed/kept names. */
  originSig?: string;
  candidates?: string[];
  turtles?: string[];
  crews?: string[];
};

export function FinaleScene({
  mafiaName,
  memberId,
  dashboardHref,
  topping,
  filmId,
  filmTitle,
  tmdbMovieId,
  origin,
  originSig,
  candidates,
  turtles,
  crews,
}: Props) {
  const t = useTranslations("onboarding.finale");
  const tName = useTranslations("onboarding.name");
  const locale = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<number>(reducedMotion ? 6 : 0);
  const [shareToast, setShareToast] = useState<string | null>(null);

  const [portrait, setPortrait] = useState<Portrait>({
    url: null,
    loading: true,
    notice: null,
    remaining: null,
    variant: 0,
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // --- Portrait -----------------------------------------------------------
  const drawPortrait = useCallback(
    async (variant: number) => {
      setPortrait((p) => ({ ...p, loading: true, notice: null }));
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), PORTRAIT_CLIENT_TIMEOUT_MS);
      let next: Partial<Portrait> = { notice: "unavailable" };
      try {
        const res = await fetch("/api/mafia-portrait", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: mafiaName, topping, turtles, crews, variant }),
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { url?: string; remaining?: number };
          if (typeof data.url === "string") {
            next = {
              url: data.url,
              notice: null,
              variant,
              ...(typeof data.remaining === "number" ? { remaining: data.remaining } : {}),
            };
          }
        } else if (res.status === 429) {
          next = { notice: "limited", remaining: 0 };
        }
      } catch {
        // timeout / network: keep whatever is on screen
      } finally {
        window.clearTimeout(timer);
      }
      if (mountedRef.current) setPortrait((p) => ({ ...p, ...next, loading: false }));
    },
    [mafiaName, topping, turtles, crews],
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void drawPortrait(0);
  }, [drawPortrait]);

  // --- Claim ----------------------------------------------------------------
  // Record the claimed name (idempotent per member + name) on mount, without
  // waiting for the portrait, and again when a portrait lands or is redrawn.
  // For a suggested name the response is the public /made/[id] page that Share
  // on X points at; typed or kept names are stored but get no public page.
  const [claimId, setClaimId] = useState<string | null>(null);
  const claimRef = useRef({ mafiaName, topping, filmId, filmTitle, tmdbMovieId, origin, originSig, candidates });
  claimRef.current = { mafiaName, topping, filmId, filmTitle, tmdbMovieId, origin, originSig, candidates };
  useEffect(() => {
    const c = claimRef.current;
    fetch("/api/mafia-name/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: c.mafiaName,
        topping: c.topping,
        filmId: c.filmId,
        filmTitle: c.filmTitle,
        tmdbMovieId: c.tmdbMovieId,
        origin: c.origin,
        originSig: c.originSig,
        candidates: c.candidates,
        portraitUrl: portrait.url ?? undefined,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { id?: string; public?: boolean } | null) => {
        // Only unmount cancels: a response for an older portrait still carries the same id.
        if (mountedRef.current && data?.public === true && typeof data.id === "string") setClaimId(data.id);
      })
      .catch(() => {});
  }, [portrait.url]);

  const showToast = (msg: string) => {
    setShareToast(msg);
    window.setTimeout(() => setShareToast(null), 2400);
  };

  const fetchPortraitBlob = async (): Promise<Blob> => {
    const res = await fetch(portrait.url!);
    if (!res.ok) throw new Error("fetch");
    return res.blob();
  };

  const handleDownload = async () => {
    if (!portrait.url) return;
    try {
      const blob = await fetchPortraitBlob();
      const ext = blob.type === "image/png" ? "png" : "webp";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${fileSafe(mafiaName)}_pizzadao.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      window.open(portrait.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyImage = async () => {
    if (!portrait.url) return;
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
      // Pass a promise so Safari keeps the user gesture while we fetch + convert.
      const png = fetchPortraitBlob().then(toPng);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      showToast(t("imageCopied"));
    } catch {
      showToast(t("copyImageFailed"));
    }
  };

  const handleShareX = () => {
    const text = t("shareXText", { name: mafiaName });
    // The public certificate once the claim is saved; /join if it could not be.
    const url = `${window.location.origin}${claimId ? `/made/${claimId}` : "/join"}`;
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // --- Share action -------------------------------------------------------
  // Tries the native share sheet first (mobile), falls back to clipboard.
  const shareUrlRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    shareUrlRef.current = window.location.origin + dashboardHref;
  }, [dashboardHref]);

  const handleShare = async () => {
    const url = shareUrlRef.current || dashboardHref;
    const text = t("shareText", { name: mafiaName });
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
        setShareToast(t("copied"));
        window.setTimeout(() => setShareToast(null), 2400);
        return;
      }
    } catch {
      // ignore — final fallback below
    }
    setShareToast(t("shareUnavailable"));
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

  const originText = originLine(tName, origin, origin?.film);
  const redrawDisabled = portrait.loading || portrait.variant >= 4 || portrait.remaining === 0;

  return (
    <section style={overlay}>
      <style>{`
        @keyframes finale-portrait-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes finale-portrait-shimmer { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.6; } }
        .finale-portrait-in { animation: finale-portrait-in 700ms var(--ease-editorial) both; }
        .finale-portrait-shimmer { animation: finale-portrait-shimmer 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .finale-portrait-in, .finale-portrait-shimmer { animation: none; }
        }
      `}</style>
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
                letterSpacing: "0.08em",
              }}
            >
              {t("record")}
            </p>
            <p
              className="overline"
              style={{
                flexShrink: 0,
                color: "hsl(var(--foreground) / 0.55)",
                letterSpacing: "0.08em",
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
              style={{
                position: "relative",
                overflow: "hidden",
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
                color: "hsl(var(--tomato-readable))",
                transform: phase >= 2 ? "rotate(-11deg) scale(1)" : "scale(0.6)",
                opacity: phase >= 2 ? 1 : 0,
                ...transition(700),
                filter: "contrast(1.06) saturate(1.04)",
              }}
            >
              <div
                aria-hidden
                style={{
                  textAlign: "center",
                  lineHeight: 1.05,
                  position: "relative",
                  zIndex: 1,
                  padding: 6,
                  opacity: portrait.url ? 0 : 1,
                  transition: reducedMotion ? "none" : "opacity 700ms var(--ease-editorial)",
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
                    letterSpacing: "0.08em",
                    opacity: 0.8,
                  }}
                >
                  PizzaDAO
                </div>
              </div>
              {portrait.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={portrait.url}
                  src={portrait.url}
                  alt={t("portraitAlt", { name: mafiaName })}
                  className={reducedMotion ? undefined : "finale-portrait-in"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    // Undo the seal's -11deg tilt; scale so the corners stay covered.
                    transform: "rotate(11deg) scale(1.25)",
                    zIndex: 2,
                  }}
                />
              )}
              {portrait.loading && (
                <div
                  aria-hidden
                  className={reducedMotion ? undefined : "finale-portrait-shimmer"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 3,
                    background: "hsl(var(--cream) / 0.18)",
                  }}
                />
              )}
            </div>

            {/* Right column — phases 3/4/5 */}
            <div style={{ minWidth: 0 }}>
              {/* Phase 3 — "Status · Made" overline */}
              <p
                className="overline"
                style={{
                  color: "hsl(var(--tomato-readable))",
                  letterSpacing: "0.08em",
                  ...transition(500),
                  opacity: phase >= 3 ? 1 : 0,
                }}
              >
                {t("madeStatus")}
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
                  color: "hsl(var(--tomato-readable))",
                  ...transition(500),
                  opacity: phase >= 5 ? 1 : 0,
                }}
              >
                {t("approved")}
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
                {t("descriptor")}
              </p>
              {originText && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: "clamp(13px, 1.3vw, 15px)",
                    fontStyle: "italic",
                    color: "hsl(var(--foreground) / 0.65)",
                    ...transition(700),
                    opacity: phase >= 5 ? 1 : 0,
                  }}
                >
                  {originText}
                </p>
              )}
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
            <DossierField label={t("status")} value={t("made")} />
            <DossierField label={t("archive")} value={`№ ${archiveNo}`} />
            <DossierField
              label={t("initiated")}
              value={new Date().toLocaleDateString(locale, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            />
            {memberId && <DossierField label={t("member")} value={`№ ${memberId}`} />}
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
              background: "hsl(var(--tomato-deep))",
              color: "hsl(var(--cream))",
              border: "1px solid hsl(var(--tomato))",
              textDecoration: "none",
            }}
          >
            {t("continueButton")}
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
            {t("shareButton")}
          </button>
          <button
            type="button"
            onClick={handleShareX}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.3)",
              cursor: "pointer",
            }}
          >
            {t("shareX")}
          </button>
        </div>

        {/* Portrait controls */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
              alignItems: "center",
              ...transition(500),
              opacity: phase >= 6 ? 1 : 0,
            }}
          >
            {portrait.loading && (
              <p className="overline" role="status" style={{ color: "hsl(var(--foreground) / 0.6)" }}>
                {t("portraitDeveloping")}
              </p>
            )}
            {!portrait.loading && portrait.notice && (
              <p className="overline" role="status" style={{ color: "hsl(var(--foreground) / 0.6)" }}>
                {portrait.notice === "limited" ? t("redrawLimit") : t("portraitUnavailable")}
              </p>
            )}
            {portrait.url && (
              <>
                <button
                  type="button"
                  onClick={() => void drawPortrait(portrait.variant + 1)}
                  disabled={redrawDisabled}
                  style={portraitButton(redrawDisabled)}
                >
                  {t("redraw")}
                  {portrait.remaining !== null && ` · ${t("redrawsLeft", { count: portrait.remaining })}`}
                </button>
                <button type="button" onClick={handleDownload} style={portraitButton(false)}>
                  {t("download")}
                </button>
                <button type="button" onClick={handleCopyImage} style={portraitButton(false)}>
                  {t("copyImage")}
                </button>
              </>
            )}
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
          § {t("footnote", { year: new Date().getFullYear() })}
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
              color: "hsl(var(--cream))",
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

function portraitButton(disabled: boolean): CSSProperties {
  return {
    background: "transparent",
    color: "hsl(var(--foreground))",
    border: "1px solid hsl(var(--foreground) / 0.25)",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
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
