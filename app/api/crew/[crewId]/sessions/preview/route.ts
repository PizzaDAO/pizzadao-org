// POST /api/crew/<crewId>/sessions/preview
//
// The text half of the live preview: the announcement as Discord will show it, the event card and
// where it will be posted. Pure (nothing is created or sent), works whether or not posting is on, and
// the date may be in the past (it is only a picture). Same auth as scheduling.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { requireSessionManager } from '@/app/lib/education-sessions/access'
import { buildAnnouncement, buildEventPayload, buildTelegramText, formatWhen, parseSessionInput, SessionInputError } from '@/app/lib/education-sessions/build'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string }> }

async function channelName(id: string, channels: Array<{ id: string; name: string }> | null): Promise<string | null> {
  if (!id) return null
  return channels?.find((c) => c.id === id)?.name ?? 'a channel'
}

const POST_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  await requireSessionManager(crewId)
  const body = await request.json().catch(() => null)
  let s
  try {
    s = parseSessionInput({ ...(body && typeof body === 'object' ? body : {}), description: (body as { description?: string } | null)?.description || '(description)' }, new Date(0))
  } catch (e) {
    if (e instanceof SessionInputError) return NextResponse.json({ ok: false, error: e.message }, { headers: NO_STORE_HEADERS })
    throw e
  }
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? ''
  const [eventId, announceId, generalId, telegramOn] = await Promise.all([
    savedChannelId('discord.educationEventChannelId'),
    savedChannelId('discord.educationChannelId'),
    savedChannelId('discord.educationGeneralChannelId'),
    toggleEnabled('telegram.sessionMirrorEnabled').catch(() => false),
  ])
  const channels = token && guildId ? await getGuildChannels({ botToken: token, guildId }).catch(() => null) : null
  const event = buildEventPayload(s, { id: eventId || '0', type: 2 })
  return NextResponse.json(
    {
      ok: true,
      announcement: buildAnnouncement(s, 'https://discord.com/events/…'),
      telegram: buildTelegramText(s, 'https://discord.com/events/…'),
      event: { name: event.name, description: event.description, when: formatWhen(s) },
      destinations: {
        event: await channelName(eventId, channels),
        announcement: await channelName(announceId, channels),
        general: generalId && generalId !== announceId ? await channelName(generalId, channels) : null,
        telegram: telegramOn,
      },
    },
    { headers: NO_STORE_HEADERS },
  )
}

export const POST = withErrorHandling(POST_HANDLER)
