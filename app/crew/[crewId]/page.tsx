import type { Metadata } from 'next'
import CrewPageClient from './CrewPageClient'
import { getCrewMappings } from '@/app/lib/crew-mappings'

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

  const title = `${emoji ? emoji + ' ' : ''}${label} Crew | PizzaDAO`
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

export default async function CrewPage({ params }: Props) {
  // Pass the params Promise straight through; the client component already
  // handles unwrapping via React.use().
  return <CrewPageClient params={params} />
}
