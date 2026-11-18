/** Toast copy for live mission updates (a pure diff, so it is easy to test). */

type Snap = {
  levels: Array<{ missions: Array<{ id: number; title: string; progress: { status: string } | null }> }>;
};

export function missionChangeToasts(prev: Snap, next: Snap): Array<{ kind: "success" | "info"; message: string }> {
  const before = new Map<number, string | undefined>();
  for (const l of prev.levels) for (const m of l.missions) before.set(m.id, m.progress?.status);
  const out: Array<{ kind: "success" | "info"; message: string }> = [];
  for (const l of next.levels) {
    for (const m of l.missions) {
      const now = m.progress?.status;
      const was = before.get(m.id);
      if (now === was) continue;
      if (now === "APPROVED") out.push({ kind: "success", message: `Mission approved: ${m.title}` });
      else if (now === "REJECTED" && was === "PENDING") out.push({ kind: "info", message: "Mission needs changes" });
    }
  }
  return out;
}

export const QUEUE_TOAST = "New mission submitted for review";
