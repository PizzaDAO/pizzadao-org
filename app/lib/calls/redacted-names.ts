import { prisma } from '@/app/lib/db'

/** Display names of a recording's redacted speakers (matched by Discord id or linked id), for dropping them as owners in public text. */
export async function redactedSpeakerNames(recordingId: string, ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return []
  const speakers = await prisma.callSpeaker.findMany({
    where: { recordingId, OR: [{ discordId: { in: [...ids] } }, { linkedDiscordId: { in: [...ids] } }] },
    select: { displayName: true },
  })
  return speakers.map((s) => s.displayName).filter((n): n is string => !!n)
}
