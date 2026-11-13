"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "@/app/(marketing)/_site/lib/router";
const bennyImg = "/marketing/assets/benny-peek.png";
const EXCLUDED_PATHS = [
  "/get-your-mafia-name",
  "/contact",
  "/partners",
  "/privacy",
  "/terms",
  "/checkout",
];

const MIN_INTERVAL_MS = 18000;
const MAX_INTERVAL_MS = 35000;
const MIN_GAP_MS = 8000;
const MAX_APPEARANCES = 6;
const MIN_CONTAINER_SIZE = 160;

type Pop = {
  target: HTMLElement;
  key: number;
  side: "left" | "center" | "right";
  height: number;
  phase: "rising" | "holding" | "ducking";
};

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < MIN_CONTAINER_SIZE || r.height < MIN_CONTAINER_SIZE) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}

export default function BennyPeek() {
  const location = useLocation();
  const [pop, setPop] = useState<Pop | null>(null);
  const appearancesRef = useRef(0);
  const lastAppearanceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const keyRef = useRef(0);

  const excluded = EXCLUDED_PATHS.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    appearancesRef.current = 0;
    lastAppearanceRef.current = 0;
    setPop(null);
  }, [location.pathname]);

  useEffect(() => {
    if (excluded || prefersReducedMotion()) return;

    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const delay =
        MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
      timerRef.current = window.setTimeout(tryPop, delay);
    };

    const tryPop = () => {
      if (cancelled) return;
      if (document.hidden) {
        schedule();
        return;
      }
      if (appearancesRef.current >= MAX_APPEARANCES) return;
      if (Date.now() - lastAppearanceRef.current < MIN_GAP_MS) {
        schedule();
        return;
      }
      const all = Array.from(
        document.querySelectorAll<HTMLElement>('[data-benny="true"]')
      ).filter(isVisible);
      if (all.length === 0) {
        schedule();
        return;
      }
      const target = all[Math.floor(Math.random() * all.length)];
      // Make sure container can host an absolutely positioned child clipped.
      const cs = getComputedStyle(target);
      if (cs.position === "static") target.style.position = "relative";
      if (cs.overflow === "visible") target.style.overflow = "hidden";

      const rect = target.getBoundingClientRect();
      const height = Math.max(120, Math.min(280, rect.height * 0.55));
      const side = (["left", "center", "right"] as const)[
        Math.floor(Math.random() * 3)
      ];

      keyRef.current += 1;
      appearancesRef.current += 1;
      lastAppearanceRef.current = Date.now();

      const next: Pop = {
        target,
        key: keyRef.current,
        side,
        height,
        phase: "rising",
      };
      setPop(next);

      // Hold then duck
      window.setTimeout(() => {
        setPop((p) => (p && p.key === next.key ? { ...p, phase: "holding" } : p));
      }, 600);
      window.setTimeout(() => {
        setPop((p) => (p && p.key === next.key ? { ...p, phase: "ducking" } : p));
      }, 600 + 1600);
      window.setTimeout(() => {
        setPop((p) => (p && p.key === next.key ? null : p));
        schedule();
      }, 600 + 1600 + 700);
    };

    schedule();

    const onVis = () => {
      if (!document.hidden && timerRef.current == null) schedule();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [excluded, location.pathname]);

  if (!pop || excluded) return null;

  const sideStyle: React.CSSProperties =
    pop.side === "left"
      ? { left: "8%" }
      : pop.side === "right"
      ? { right: "8%" }
      : { left: "50%", transform: "translateX(-50%)" };

  const translateY =
    pop.phase === "rising" || pop.phase === "ducking" ? "100%" : "0%";

  const baseTransform =
    pop.side === "center"
      ? `translateX(-50%) translateY(${translateY})`
      : `translateY(${translateY})`;

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: 0,
        ...sideStyle,
        height: pop.height,
        width: "auto",
        zIndex: 30,
        pointerEvents: "none",
        transform: baseTransform,
        transition: "transform 700ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        willChange: "transform",
      }}
      onClick={() => setPop((p) => (p ? { ...p, phase: "ducking" } : p))}
    >
      <img
        src={bennyImg}
        alt=""
        draggable={false}
        style={{
          height: "100%",
          width: "auto",
          display: "block",
          pointerEvents: "auto",
          cursor: "pointer",
          filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.18))",
          animation:
            pop.phase === "holding"
              ? "benny-wave 1.4s ease-in-out"
              : undefined,
          transformOrigin: "bottom center",
        }}
      />
      <style>{`
        @keyframes benny-wave {
          0%   { transform: rotate(0deg) translateY(0); }
          20%  { transform: rotate(-5deg) translateY(-4px); }
          45%  { transform: rotate(6deg) translateY(0); }
          65%  { transform: rotate(-4deg) translateY(-3px); }
          85%  { transform: rotate(3deg) translateY(0); }
          100% { transform: rotate(0deg) translateY(0); }
        }
      `}</style>
    </div>,
    pop.target
  );
}
