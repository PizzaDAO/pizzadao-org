/**
 * Calls the Google Apps Script "SecretService" web app for the parts of the
 * Community Call announcement that still live there: start the Discord
 * scheduled event, post the tweet, and take voice attendance (now + a
 * 10-minute burst for 60 minutes).
 *
 * The Discord message itself is posted directly by run.ts, so every Discord
 * post option is turned off here to avoid double-posting.
 *
 * Server-side only.
 */

export interface SecretServiceConfig {
  url: string;
  password: string;
  spreadsheetId: string;
}

export interface SecretServiceResult {
  success: boolean;
  error?: string;
  /** SecretService's per-step results (discordEvent / tweet / attendance). */
  results?: Record<string, unknown>;
}

/** SecretService does event + tweet + attendance; generous but bounded. */
export const SECRET_SERVICE_TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 3;

export function getSecretServiceConfig(
  spreadsheetId: string,
  env: Record<string, string | undefined> = process.env,
): SecretServiceConfig | null {
  const url = env.ANNOUNCE_WEBAPP_URL?.trim();
  const password = env.ANNOUNCE_PASSWORD?.trim();
  if (!url || !password) return null;
  return { url, password, spreadsheetId };
}

export function buildSecretServicePayload(cfg: SecretServiceConfig) {
  return {
    password: cfg.password,
    spreadsheetId: cfg.spreadsheetId,
    action: "announce",
    // Event, tweet and attendance default to on in handleAnnounce_; the
    // Discord channel posts are off because run.ts already posted.
    options: { postGeneral: false, postBand: false, postCrew: false },
  };
}

/**
 * POST the announce action to SecretService. Apps Script web apps answer a
 * POST with a 302 to script.googleusercontent.com, which must be fetched with
 * GET (same pattern as fetchWithRedirect in sheet-utils). Never throws.
 */
export async function callSecretServiceAnnounce(
  cfg: SecretServiceConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SECRET_SERVICE_TIMEOUT_MS,
): Promise<SecretServiceResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let res = await fetchImpl(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSecretServicePayload(cfg)),
      redirect: "manual",
      cache: "no-store",
      signal,
    });

    for (let i = 0; (res.status === 301 || res.status === 302 || res.status === 303) && i < MAX_REDIRECTS; i++) {
      const location = res.headers.get("location");
      if (!location) return { success: false, error: `SecretService redirected (${res.status}) without a location` };
      res = await fetchImpl(location, { method: "GET", redirect: "manual", cache: "no-store", signal });
    }

    const text = await res.text();
    let parsed: { success?: boolean; error?: string; results?: Record<string, unknown>; partialResults?: Record<string, unknown> };
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `SecretService returned a non-JSON response (status ${res.status}): ${text.trim().slice(0, 200)}`,
      };
    }
    if (parsed.success !== true) {
      return {
        success: false,
        error: `SecretService: ${parsed.error ?? `unsuccessful response (status ${res.status})`}`,
        results: parsed.partialResults ?? parsed.results,
      };
    }
    return { success: true, results: parsed.results };
  } catch (err) {
    const msg =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : String(err);
    return { success: false, error: `Could not reach SecretService: ${msg}` };
  }
}
