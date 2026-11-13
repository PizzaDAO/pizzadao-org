"use client";

/**
 * Same-origin calls to the app's public marketing endpoints (/api/public/newsletter, contact). Resolves to { data, error } so the ported components keep the shape they had with the
 * old hosted functions: `error` is set for any failure or a non-2xx answer, and never throws.
 */
export async function invokeForm<T = Record<string, unknown> & { ok?: boolean; already?: boolean }>(
  path: string,
  opts: { body?: unknown } = {},
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const res = await fetch(path, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) return { data, error: new Error(`HTTP ${res.status}`) };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error("Request failed") };
  }
}

/** The honeypot field's value from a submitted form (empty for real visitors). */
export const honeypot = (e: { currentTarget: EventTarget | null }): string => {
  const form = e.currentTarget;
  return form instanceof HTMLFormElement ? String(new FormData(form).get("website") ?? "") : "";
};
