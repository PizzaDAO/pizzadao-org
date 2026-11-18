"use client";

import { useEffect, useRef } from "react";

/** What GET /api/missions/version returns. */
export type MissionVersion = { mine: string; queue: string | null; intervalSeconds: number };

export const DEFAULT_LIVE_SECONDS = 15;
export const MAX_BACKOFF_MS = 120_000;

/** Delay before the next poll: the interval, doubled per consecutive error (capped). */
export function nextDelayMs(intervalSeconds: number, errors: number): number {
  const base = intervalSeconds * 1000;
  return Math.min(base * 2 ** Math.min(errors, 6), Math.max(base, MAX_BACKOFF_MS));
}

type Opts = {
  /** Poll only when true (e.g. signed in). */
  enabled?: boolean;
  /** Ask for the reviewer queue marker too (the server still checks the role). */
  queue?: boolean;
  /** Called when a marker changes after the first reading (never for the baseline). */
  onChange: (change: { mine: boolean; queue: boolean }, version: MissionVersion) => void;
};

/**
 * Polls /api/missions/version only while the tab is visible (paused when hidden, an immediate
 * check on becoming visible / focus), backs off on errors, stops on 401 or when the admin setting
 * is 0, and calls `onChange` when the viewer's marker changes. The first reading is the baseline.
 */
export function useLiveVersion({ enabled = true, queue = false, onChange }: Opts) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seconds = DEFAULT_LIVE_SECONDS;
    let errors = 0;
    let last: MissionVersion | null = null;
    let inflight = false;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const schedule = () => {
      clear();
      if (stopped || seconds <= 0 || !visible()) return;
      timer = setTimeout(check, nextDelayMs(seconds, errors));
    };

    async function check() {
      clear();
      if (stopped || inflight || !visible()) return;
      inflight = true;
      try {
        const res = await fetch(`/api/missions/version${queue ? "?queue=1" : ""}`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          stopped = true;
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const v = (await res.json()) as MissionVersion;
        errors = 0;
        seconds = Number.isFinite(v.intervalSeconds) ? v.intervalSeconds : DEFAULT_LIVE_SECONDS;
        if (last) {
          const mine = v.mine !== last.mine;
          const q = v.queue !== last.queue;
          if (mine || q) onChangeRef.current({ mine, queue: q }, v);
        }
        last = v;
      } catch {
        errors += 1;
      } finally {
        inflight = false;
        schedule();
      }
    }

    const wake = () => {
      if (visible()) void check();
      else clear();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    void check();
    return () => {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, queue]);
}
