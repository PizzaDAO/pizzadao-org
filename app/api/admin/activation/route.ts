import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { ACTIVATION_STAGES } from "@/app/lib/activation";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const rows = await prisma.activationEvent.findMany({ where: { createdAt: { gte: since } }, select: { actor: true, event: true, code: true }, take: 20001, orderBy: { createdAt: "desc" } });
    const starters = new Set(rows.filter(r => r.event === "signup_started").map(r => r.actor));
    const stages = ACTIVATION_STAGES.map(event => ({ event, count: new Set(rows.filter(r => r.event === event && starters.has(r.actor)).map(r => r.actor)).size }));
    const failures = new Map<string, Set<string>>();
    for (const r of rows.filter(r => ["login_failed", "profile_save_failed", "client_error"].includes(r.event))) {
      const key = `${r.event}:${r.code}`;
      if (!failures.has(key)) failures.set(key, new Set());
      failures.get(key)!.add(r.actor);
    }
    // Bound retention, including abandoned signup data. No raw PII in events.
    await prisma.activationEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
    return NextResponse.json({ days: 30, truncated: rows.length > 20000, stages, failures: Array.from(failures, ([code, actors]) => ({ code, count: actors.size })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Activation reporting is unavailable" }, { status: 503 }); }
}
