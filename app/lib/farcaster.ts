const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

export type FarcasterUser = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
};

/**
 * Resolve a Farcaster username to FID + profile via Neynar API
 */
export async function lookupFarcasterUser(
  username: string
): Promise<FarcasterUser | null> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error("NEYNAR_API_KEY not configured");

  const res = await fetch(
    `${NEYNAR_BASE}/user/by_username?username=${encodeURIComponent(username)}`,
    {
      headers: { "x-api-key": apiKey },
    }
  );

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Neynar lookup failed: ${res.status}`);
  }

  const data = await res.json();
  const user = data.user;
  if (!user) return null;

  return {
    fid: user.fid,
    username: user.username,
    displayName: user.display_name || user.username,
    pfpUrl: user.pfp_url || "",
  };
}

/**
 * Get the full following list for a Farcaster user (paginated, returns all pages)
 */
export async function getFarcasterFollowing(
  fid: number
): Promise<FarcasterUser[]> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error("NEYNAR_API_KEY not configured");

  const all: FarcasterUser[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL(`${NEYNAR_BASE}/following`);
    url.searchParams.set("fid", String(fid));
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
    });

    if (!res.ok) throw new Error(`Neynar following failed: ${res.status}`);

    const data = await res.json();
    const users = data.users || [];

    for (const u of users) {
      all.push({
        fid: u.fid,
        username: u.username,
        displayName: u.display_name || u.username,
        pfpUrl: u.pfp_url || "",
      });
    }

    cursor = data.next?.cursor || null;
  } while (cursor);

  return all;
}
