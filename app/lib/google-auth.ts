/**
 * Google service-account auth, built once per scope set.
 *
 * Credentials come from GOOGLE_SERVICE_ACCOUNT_JSON (the full key JSON). If the
 * variable is unset, google-auth-library falls back to Application Default
 * Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS pointing at a key file),
 * which is how to run locally without pasting the JSON into an env var.
 *
 * Server-side only.
 */

import { google } from "googleapis";

export const GOOGLE_SCOPES = {
  sheetsReadonly: "https://www.googleapis.com/auth/spreadsheets.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
} as const;

type GoogleAuth = InstanceType<typeof google.auth.GoogleAuth>;

type Credentials = Record<string, unknown>;

let parsedCredentials: { raw: string | undefined; value: Credentials | undefined } | null = null;

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON (memoized on the raw value).
 * Returns undefined when unset; throws when set but not valid JSON.
 */
export function getServiceAccountCredentials(): Credentials | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || undefined;
  if (parsedCredentials && parsedCredentials.raw === raw) return parsedCredentials.value;

  let value: Credentials | undefined;
  if (raw) {
    try {
      value = JSON.parse(raw) as Credentials;
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Please ensure it is the full object starting with '{' and ending with '}'.",
      );
    }
  }
  parsedCredentials = { raw, value };
  return value;
}

/** True when GOOGLE_SERVICE_ACCOUNT_JSON is set and parses. */
export function hasServiceAccountCredentials(): boolean {
  try {
    return getServiceAccountCredentials() !== undefined;
  } catch {
    return false;
  }
}

const authByScopes = new Map<string, GoogleAuth>();

/**
 * Return a GoogleAuth client for the given scopes, reusing one instance per
 * distinct scope set so access tokens are cached across calls.
 */
export function getGoogleAuth(scopes: readonly string[]): GoogleAuth {
  const key = [...new Set(scopes)].sort().join(" ");
  const existing = authByScopes.get(key);
  if (existing) return existing;

  const auth = new google.auth.GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes: [...scopes],
  });
  authByScopes.set(key, auth);
  return auth;
}

/** Test helper: drop memoized credentials and clients. */
export function __resetGoogleAuthForTests(): void {
  parsedCredentials = null;
  authByScopes.clear();
}
