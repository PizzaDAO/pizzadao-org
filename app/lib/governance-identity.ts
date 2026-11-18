/**
 * Best-effort "create voting identity" call to the external governance service.
 * Skipped entirely unless GOVERNANCE_API_URL and GOVERNANCE_API_SECRET are both set.
 * Never sends the Sheets secret. Callers should run this inside `after()`.
 */
const TIMEOUT_MS = 5000;

export function governanceEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.GOVERNANCE_API_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const localDev =
    env.NODE_ENV === "development" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(localDev && url.protocol === "http:")) return null;
  return new URL("/api/governance/create-identity", url).toString();
}

export async function createGovernanceIdentity(
  discordId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const endpoint = governanceEndpoint(env);
  const secret = env.GOVERNANCE_API_SECRET?.trim();
  if (!endpoint || !secret) return;
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordId, secret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Best effort: never fail the claim over identity creation.
  }
}
