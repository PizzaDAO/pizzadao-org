import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { checkSecret } from "@/app/lib/auth-guards";
import { invalidateMembersCache } from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

// Secret key for authorization: CACHE_INVALIDATE_SECRET (set in Vercel env vars).
// The GET ?secret= variant was removed (secrets in URLs leak via logs/history).

/**
 * Cache invalidation endpoint
 *
 * Can be called from Google Apps Script when sheets are edited:
 *
 * POST /api/cache-invalidate
 * Headers: { "Authorization": "Bearer YOUR_SECRET" }
 * Body: { "pattern": "crew-mappings" } or { "keys": ["key1", "key2"] }
 *
 * Patterns:
 * - "crew-mappings" - Invalidate crew mappings cache
 * - "task-links" - Invalidate all task links
 * - "members" / "member-turtles" - Expire the members-sheet data cache (tag "members")
 * - "all" - Invalidate everything
 */
export async function POST(req: Request) {
  try {
    // Check authorization (constant-time; 503 if the secret is not configured)
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const denied = checkSecret(token, "CACHE_INVALIDATE_SECRET");
    if (denied) return denied;

    // Check if KV is configured
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: "KV not configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const { pattern, keys } = body as { pattern?: string; keys?: string[] };

    const deletedKeys: string[] = [];

    if (keys && Array.isArray(keys)) {
      // Delete specific keys
      for (const key of keys) {
        await kv.del(key);
        deletedKeys.push(key);
      }
    } else if (pattern) {
      // Members-sheet reads live in Next's data cache, not KV.
      if (pattern === "members" || pattern === "member-turtles" || pattern === "all") {
        invalidateMembersCache();
      }

      // Delete keys matching pattern
      const allKeys = await kv.keys("*");

      for (const key of allKeys) {
        let shouldDelete = false;

        switch (pattern) {
          case "crew-mappings":
            shouldDelete = key.includes("crew-mappings");
            break;
          case "task-links":
            shouldDelete = key.includes("task-links") || key.includes("col-links");
            break;
          case "member-turtles":
            shouldDelete = key.includes("member-turtles");
            break;
          case "all":
            shouldDelete = true;
            break;
          default:
            shouldDelete = key.includes(pattern);
        }

        if (shouldDelete) {
          await kv.del(key);
          deletedKeys.push(key);
        }
      }
    }


    return NextResponse.json({
      success: true,
      deleted: deletedKeys.length,
      keys: deletedKeys
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? "Unknown error") }, { status: 500 });
  }
}
