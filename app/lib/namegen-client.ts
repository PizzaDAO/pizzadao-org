"use client";
// Browser call to /api/namegen, shared by the /join wizard and the public
// /get-your-mafia-name page so both ask for names the same way.
import { LS_KEY, type NamegenResponse } from "@/app/ui/onboarding/types";

export async function requestNamegen(
  input: { topping: string; movieTitle: string; style: string; force: boolean; exclude: string[] },
  fallbackError: string,
): Promise<NamegenResponse> {
  const res = await fetch("/api/namegen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await res.json().catch(() => null)) as NamegenResponse | { error?: string } | null;
  if (!res.ok) throw new Error((result as { error?: string } | null)?.error || fallbackError);
  return result as NamegenResponse;
}

/**
 * Anonymous browser id for the funnel. It is the same `sessionId` the /join
 * wizard keeps in localStorage, so a visitor who clicks "Join the family" stays
 * one actor from the public page through signup. Falls back to a per-load id
 * when storage is unavailable.
 */
export function getAnonymousActor(): string {
  const fresh = () => `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (typeof parsed.sessionId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(parsed.sessionId)) return parsed.sessionId;
    const sessionId = fresh();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...parsed, sessionId }));
    return sessionId;
  } catch {
    return fresh();
  }
}
