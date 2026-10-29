/**
 * Labelling the diarized speakers of an imported call (reviewer action).
 */
import { prisma } from '@/app/lib/db'
import { isImportedSource } from './imported'
import { importedSpeakerNumber, tidyLabel } from './speaker-labels'

export type LabelResult = 'ok' | 'not-found' | 'not-supported' | 'invalid'

/**
 * Name (or un-name) a diarized speaker on an imported call. An empty name and no member = back to
 * "Speaker N". A member link sets `linkedDiscordId` (the caller has checked the member exists) and, when no
 * name is typed, `displayName` is `memberName`. Labels never touch the transcript keys, so redactions stay
 * valid. The summary may predate the labels (speakerLabelsUpdatedAt says so); a PUBLISHED call goes back to
 * review because its public text changed.
 */
export async function setSpeakerLabel(
  id: string,
  speakerId: string,
  label: { displayName?: string | null; linkedDiscordId?: string | null; memberName?: string | null },
  now = new Date(),
): Promise<LabelResult> {
  if (importedSpeakerNumber(speakerId) === null) return 'invalid'
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { id: true, status: true, source: true, speakers: { where: { discordId: speakerId }, select: { id: true } } },
  })
  if (!rec || rec.status === 'REJECTED' || rec.status === 'PROCESSING') return 'not-found'
  if (!isImportedSource(rec.source)) return 'not-supported'
  if (rec.speakers.length === 0) return 'not-found'
  const typed = tidyLabel(label.displayName)
  const linked = label.linkedDiscordId ?? null
  const displayName = typed || (linked ? tidyLabel(label.memberName) : '') || null
  if (linked && !displayName) return 'invalid'
  await prisma.$transaction([
    prisma.callSpeaker.updateMany({ where: { recordingId: id, discordId: speakerId }, data: { displayName, linkedDiscordId: linked } }),
    prisma.callRecording.update({
      where: { id },
      data: { speakerLabelsUpdatedAt: now, ...(rec.status === 'PUBLISHED' ? { status: 'IN_REVIEW' as const, publishedAt: null } : {}) },
    }),
  ])
  return 'ok'
}
