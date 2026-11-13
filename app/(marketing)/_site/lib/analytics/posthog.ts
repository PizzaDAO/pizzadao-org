"use client";

/**
 * Thin typed wrapper around posthog-js. Safe no-op when key is missing.
 */
import posthog from "posthog-js";
import {
  HIGH_INTENT_PATHS,
  POSTHOG_DEBUG,
  POSTHOG_HOST,
  POSTHOG_KEY,
  REPLAY_GLOBAL_SAMPLE,
} from "./config";
import type { EventName } from "./events";

let initialized = false;

// False while the visitor is on an app page (the provider only mounts under the marketing layout).
let active = true;

export function isEnabled(): boolean {
  return initialized && active && Boolean(POSTHOG_KEY);
}

/**
 * Turn capturing (events, autocapture, session recording) off or back on. The provider calls this
 * with false when the marketing layout unmounts, so soft navigation into the app never tracks.
 */
export function setActive(on: boolean): void {
  active = on;
  if (!initialized || !POSTHOG_KEY) return;
  try {
    if (on) {
      posthog.opt_in_capturing();
    } else {
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
    }
  } catch {
    /* noop */
  }
}

export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (!POSTHOG_KEY) {
    if (POSTHOG_DEBUG) console.warn("[analytics] No PostHog key configured.");
    return;
  }

  // Respect Do Not Track - switch to memory persistence (no cookies).
  const dnt =
    typeof navigator !== "undefined" &&
    (navigator.doNotTrack === "1" ||
      // @ts-expect-error legacy
      window.doNotTrack === "1");

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: "2026-01-30",
    capture_pageview: false, // we capture manually on SPA route changes
    capture_pageleave: true,
    autocapture: true,
    persistence: dnt ? "memory" : "localStorage+cookie",
    mask_all_text: false,
    // PII safety: mask every input by default; we opt-in to plain text via classes.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask]",
    },
    // Sample replays globally; we'll force-record on high-intent routes below.
    disable_session_recording: false,
    enable_recording_console_log: true,
    loaded: (ph) => {
      if (POSTHOG_DEBUG) ph.debug();
      // Decide replay sampling per current path.
      maybeForceReplay(window.location.pathname);
    },
  });

  // Default sample rate via cookie property; PostHog reads server-side too.
  posthog.register({ replay_sample_rate: REPLAY_GLOBAL_SAMPLE });

  initialized = true;
}

function maybeForceReplay(path: string) {
  if (!isEnabled()) return;
  if (HIGH_INTENT_PATHS.some((p) => path.startsWith(p))) {
    try {
      posthog.startSessionRecording();
    } catch {
      /* noop */
    }
  }
}

export function trackPageView(path: string, search: string): void {
  if (!isEnabled()) return;
  const url = `${window.location.origin}${path}${search}`;
  posthog.capture("$pageview", {
    $current_url: url,
    path,
    gate_unlocked:
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("pd-unlocked") === "1",
  });
  maybeForceReplay(path);
}

export function track(
  event: EventName | string,
  properties: Record<string, unknown> = {},
): void {
  if (!isEnabled()) return;
  posthog.capture(event, properties);
}

/** Stable, non-PII person id derived from email. */
async function hashEmail(email: string): Promise<string> {
  const enc = new TextEncoder().encode(email.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function identifyByEmail(
  email: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!isEnabled()) return;
  if (!email) return;
  const id = await hashEmail(email);
  // Hashed id only: the raw address is never sent as a person property.
  posthog.identify(id, { ...properties });
}

export function registerOnce(props: Record<string, unknown>): void {
  if (!isEnabled()) return;
  posthog.register_once(props);
}

export function register(props: Record<string, unknown>): void {
  if (!isEnabled()) return;
  posthog.register(props);
}

export function reset(): void {
  if (!isEnabled()) return;
  posthog.reset();
}

/** Capture UTM + referrer on first touch and last-touch each session. */
export function captureAttribution(): void {
  if (!isEnabled()) return;
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  const utms: Record<string, string> = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
    (k) => {
      const v = sp.get(k);
      if (v) utms[k] = v;
    },
  );
  const referrer = document.referrer || "direct";
  const referrer_host = (() => {
    try {
      return document.referrer ? new URL(document.referrer).host : "direct";
    } catch {
      return "direct";
    }
  })();

  registerOnce({
    first_touch: {
      ...utms,
      referrer,
      referrer_host,
      landing_path: window.location.pathname,
      ts: new Date().toISOString(),
    },
  });
  register({
    last_touch: {
      ...utms,
      referrer,
      referrer_host,
      landing_path: window.location.pathname,
    },
  });
}
