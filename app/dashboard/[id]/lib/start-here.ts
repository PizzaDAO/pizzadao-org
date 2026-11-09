// The "Start here" card's mission step, from the member's current-level missions.
export type StartHereMission = { state: "todo" | "pending" | "done"; id?: number; title?: string };

/** A mission that was never submitted or was sent back (rejected) is still to do; pending is waiting. */
export function startHereMission(
  missions: Array<{ id: number; title: string; state: "done" | "pending" | "todo" }>,
): StartHereMission {
  const todo = missions.find((m) => m.state === "todo");
  if (todo) return { state: "todo", id: todo.id, title: todo.title };
  if (missions.some((m) => m.state === "pending")) return { state: "pending" };
  return { state: "done" };
}
