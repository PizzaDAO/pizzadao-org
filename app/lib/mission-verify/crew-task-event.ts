/**
 * Mission hook for crew tasks: when tasks move to Done, re-run the crew_task_done verifier for the
 * members who lead them, so the "Complete a task from a crew" mission completes promptly (the nightly
 * sweep is the backstop). Best effort and never throws: it must not fail a task save.
 */
import { after } from 'next/server'
import { isClosedStage } from '../crew-mappings'
import { prisma } from '../db'
import { emitMissionEvent } from './events'

/** Whether a stage change closes a task that was not closed before (Done or Skip: the verifier tells them apart). */
export function closedNow(prevStage: string | null | undefined, nextStage: string | null | undefined): boolean {
  return !!nextStage && isClosedStage(nextStage) && !(prevStage && isClosedStage(prevStage))
}

/** Emit `crew_task_done` for the leads of these tasks (looked up after the save committed). */
export async function emitCrewTaskDone(taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return
  try {
    const tasks = await prisma.crewTask.findMany({ where: { id: { in: [...taskIds] } }, select: { leadMemberId: true } })
    const memberIds = [...new Set(tasks.map((t) => t.leadMemberId).filter((m): m is string => !!m))]
    if (memberIds.length === 0) return
    const members = await prisma.member.findMany({ where: { id: { in: memberIds }, discordId: { not: null } }, select: { id: true, discordId: true } })
    for (const m of members) await emitMissionEvent(m.discordId as string, 'crew_task_done', { memberId: m.id })
  } catch (err) {
    console.error('[missions] crew_task_done hook failed:', err instanceof Error ? err.message : err)
  }
}

/** Schedule the hook with the response (falls back to running it right away outside a request). */
export function emitCrewTaskDoneLater(taskIds: readonly string[]): void {
  if (taskIds.length === 0) return
  const run = () => emitCrewTaskDone(taskIds)
  try {
    after(run)
  } catch {
    void run()
  }
}
