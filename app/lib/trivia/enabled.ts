// app/lib/trivia/enabled.ts
//
// The one gate for everything in the Discord loop that posts, accepts answers or pays. Previews share the
// production database, so beyond the settings switch (trivia.enabled, off by default; the env kill switch
// TRIVIA_DISCORD_ENABLED=off wins) the loop only ever runs on the production deployment.
import { toggleEnabled } from "@/app/lib/settings/toggles";

export function isProductionDeploy(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** True only on production with trivia.enabled on. Never throws (an unreadable setting means off). */
export async function triviaLive(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!isProductionDeploy(env)) return false;
  try {
    return await toggleEnabled("trivia.enabled", env);
  } catch {
    return false;
  }
}
