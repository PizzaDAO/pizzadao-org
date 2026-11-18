// app/lib/trivia/api.ts
//
// Small helpers shared by the /api/trivia routes.
import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/app/lib/no-store";

/** Every trivia API response is per request (the daily is per member, practice is random): never stored by the CDN. */
export function reply(body: unknown, status = 200, headers: Record<string, string> = NO_STORE_HEADERS): NextResponse {
  return NextResponse.json(body, { status, headers });
}

export function withNoStore(r: NextResponse): NextResponse {
  r.headers.set("Cache-Control", "private, no-store");
  return r;
}

export const MAX_ANSWER_INPUT = 200;

/** The `answer` string of a JSON body, or null if missing, not a string or absurdly long. */
export function readAnswer(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const a = (body as { answer?: unknown }).answer;
  return typeof a === "string" && a.length <= MAX_ANSWER_INPUT ? a : null;
}
