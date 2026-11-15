import type { Metadata } from 'next'
import CrewPageClient from './CrewPageClient'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { loadSwitches } from '@/app/lib/features/service'
import { redirect } from 'next/navigation'
import { COMMUNITY_CALL_ATTENDANCE_ID, isNonCrewId, NON_ROSTER_CREW_IDS, normalizeCrewId } from '@/app/lib/crew-id'

type Props = { params: Promise<{ crewId: string }> }

function fallbackMission(crewId: string, label: string): string {
  return `${label} is one of the PizzaDAO working groups. See the roster, recent activity, and how to join.`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { crewId } = await params

  let label = crewId
  let emoji: string | undefined
  try {
    const { crews } = await getCrewMappings()
    const match = crews.find(
      (c) =>
        c.id?.toLowerCase() === crewId.toLowerCase() ||
        c.label?.toLowerCase() === crewId.toLowerCase()
    )
    if (match) {
      label = match.label
      emoji = match.emoji
    }
  } catch {
    // Best-effort: fall through to defaults if crew mappings can't be fetched.
  }

  const title = `${emoji ? emoji + ' ' : ''}${label} Crew`
  const description = fallbackMission(crewId, label)

  return {
    title,
    description,
    openGraph: {
      title: `${label} Crew`,
      description,
      type: 'website',
      siteName: 'PizzaDAO',
    },
    twitter: {
      card: 'summary',
      title: `${label} Crew`,
      description,
    },
  }
}

/** Whether this crew's page links to the public features catalog (features.crewId). Fails closed. */
async function linksFeatures(crewId: string): Promise<boolean> {
  try {
    const s = await loadSwitches()
    return s.publicEnabled && !!s.crewId && s.crewId.toLowerCase() === crewId.toLowerCase()
  } catch {
    return false
  }
}

/** Where a crew id that is not a crew should go, or null for a real (or unknown) crew. */
async function nonCrewRedirect(crewId: string): Promise<string | null> {
  const id = normalizeCrewId(crewId)
  const communityCall = `/calls?crew=${encodeURIComponent(COMMUNITY_CALL_ATTENDANCE_ID)}`
  if (NON_ROSTER_CREW_IDS.has(id)) return communityCall
  try {
    const { crews } = await getCrewMappings()
    if (isNonCrewId(id, crews)) return '/calls'
  } catch {
    // Best-effort: an unreadable registry renders the crew page as before.
  }
  return null
}

export default async function CrewPage({ params }: Props) {
  // Pass the params Promise straight through; the client component already
  // handles unwrapping via React.use().
  const { crewId } = await params
  // The Community Call (and any other registry entry that is not a crew) has no crew page: send
  // visitors to its calls instead.
  const target = await nonCrewRedirect(crewId)
  if (target) redirect(target)
  return <CrewPageClient params={params} featuresLink={await linksFeatures(crewId)} />
}
