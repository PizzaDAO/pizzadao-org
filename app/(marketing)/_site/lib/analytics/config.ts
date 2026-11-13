/**
 * PostHog configuration for the marketing pages only.
 *
 * Both values come from the environment; nothing is hard-coded. With no key set, analytics is a
 * silent no-op and the site works as normal.
 *
 *   NEXT_PUBLIC_POSTHOG_KEY=phc_xxx        (the project key, a publishable client key)
 *   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   (or https://eu.i.posthog.com)
 *   NEXT_PUBLIC_POSTHOG_DEBUG=1            (optional: verbose console output)
 *
 * The values are read through literal `process.env.NEXT_PUBLIC_*` references so Next can inline them.
 */

export const POSTHOG_KEY: string = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";

export const POSTHOG_HOST: string = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

/** Routes that get 100% session-replay sampling (the rest get the global rate). */
export const HIGH_INTENT_PATHS = [
  "/contact",
  "/partners",
  "/community",
];

/** Global session-replay sampling rate (0–1). High-intent paths always record. */
export const REPLAY_GLOBAL_SAMPLE = 0.1;

/** Force-enable in dev with NEXT_PUBLIC_POSTHOG_DEBUG=1 */
export const POSTHOG_DEBUG: boolean = process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "1";
