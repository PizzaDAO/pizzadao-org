import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

// Secret key for authorization (set in Vercel env vars)
const CACHE_SECRET = process.env.CACHE_INVALIDATE_SECRET;

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
 * - "all" - Invalidate everything
 */
export async function POST(req: Request) {
  try {
    // Check authorization
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!CACHE_SECRET || token !== CACHE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if KV is configured
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: "KV not configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const { pattern, keys } = body as { pattern?: string; keys?: string[] };

    let deletedKeys: string[] = [];

    if (keys && Array.isArray(keys)) {
      // Delete specific keys
      for (const key of keys) {
        await kv.del(key);
        deletedKeys.push(key);
      }
    } else if (pattern) {
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

// Also support GET for simple invalidation (with secret in query param)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const pattern = url.searchParams.get("pattern") || "all";

  if (!CACHE_SECRET || secret !== CACHE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Forward to POST handler
  const fakeReq = {
    headers: new Headers({ "Authorization": `Bearer ${secret}` }),
    json: async () => ({ pattern }),
  } as Request;

  return POST(fakeReq);
}
