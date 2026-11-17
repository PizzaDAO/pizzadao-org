/**
 * Run an API route handler in-process (no HTTP hop) to prefill a page on the server, so the
 * page ships its first data in the HTML instead of fetching after hydration. Returns null on
 * any failure; the client component then falls back to fetching the same route.
 */
export async function prefetchRoute<T>(
  handler: (req: never, ctx: never) => Promise<Response> | Response,
  path: string,
  ctx?: unknown,
): Promise<T | null> {
  try {
    const { NextRequest } = await import("next/server");
    const res = await handler(new NextRequest(new URL(path, "http://localhost")) as never, ctx as never);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
