/**
 * Starting content for the six "find your lane" tracks (plans/lane-cards-mission-onboarding.md).
 * Used only by scripts/lanes/seed.mjs, which inserts a lane that does not exist yet as UNPUBLISHED
 * with these draft steps and never overwrites a row: the database is the source of truth after the
 * first run and everything here is edited in /admin/lanes. Keep the text generic.
 *
 * The Gather, Experiment and Grow steps have no existing SOP behind them: they are drafts for the
 * people who run those programs to rewrite before the lane is published.
 */
import type { StepKind } from './links'

export interface SeedStep {
  title: string
  body: string
  linkHref?: string
  linkLabel?: string
  kind: StepKind
}

export interface SeedLane {
  slug: string
  tag: string
  title: string
  summary: string
  position: number
  crewId: string | null
  /** Mission title (exact, case-insensitive) looked up at seed time; missing -> guide only. */
  missionTitle: string
  stretchMissionTitles: string[]
  steps: SeedStep[]
}

export const SEED_LANES: SeedLane[] = [
  {
    slug: 'host',
    tag: 'Host',
    title: 'Throw a pizza party',
    summary: 'Pick a date, pick a pizzeria, and bring your neighborhood together. This guide walks you through it.',
    position: 1,
    crewId: 'events',
    missionTitle: 'Throw a pizza party',
    stretchMissionTitles: ['Host a Global Pizza Party'],
    steps: [
      { title: 'Read the host guide', body: 'Skim the whole guide first so nothing surprises you later.', linkHref: '/handbook/host-a-party#before', linkLabel: 'Open the host guide', kind: 'read' },
      { title: 'Plan your budget', body: 'Work out what the party costs and what support is available.\n\nHost support is capped at {{hostCapUsd}} per party.', linkHref: '/handbook/host-a-party#budget', linkLabel: 'Budget and the cap', kind: 'read' },
      { title: 'Do the pizza math', body: 'Estimate how many pizzas your guest list needs.', linkHref: '/handbook/host-a-party#pizza-math', linkLabel: 'Pizza math', kind: 'read' },
      { title: 'Create your event page', body: 'Set up an event page so guests can RSVP.\n\n[Create the event]({{eventsUrl}})', kind: 'do' },
      { title: 'Announce it', body: 'Tell your city and the community where and when.', linkHref: '/handbook/host-a-party#announce', linkLabel: 'How to announce', kind: 'do' },
      { title: 'Make a POAP', body: 'Give guests a keepsake for showing up.', linkHref: '/handbook/make-a-poap', linkLabel: 'Make a POAP', kind: 'do' },
      { title: 'Day-of checklist', body: 'Go through the day-of list before doors open.', linkHref: '/handbook/host-a-party#day-of', linkLabel: 'Day-of checklist', kind: 'read' },
      { title: 'After the party', body: 'Collect photos and receipts as described in the guide.', linkHref: '/handbook/host-a-party#after', linkLabel: 'After the party', kind: 'do' },
      { title: 'Submit your mission', body: 'Share a link to your event page or photo album.', kind: 'submit' },
    ],
  },
  {
    slug: 'build',
    tag: 'Build',
    title: 'Ship tools + projects',
    summary: 'Pick up an open project or pitch your own, and ship something real people use.',
    position: 2,
    crewId: 'tech',
    missionTitle: 'Bounty hunter',
    stretchMissionTitles: ['Writer'],
    steps: [
      { title: 'Join a Tech crew call', body: 'Say hi, hear what is being built and what needs hands.', linkHref: '/crews', linkLabel: 'Find the Tech crew', kind: 'do' },
      { title: 'Browse projects and open bounties', body: 'Look for something that matches your skills.', linkHref: '/tech/projects', linkLabel: 'Open projects', kind: 'read' },
      { title: 'Claim a bounty or pitch your own', body: 'Claim one, or post your idea in the Tech crew channel and get a thumbs up first.', kind: 'do' },
      { title: 'Ship it', body: 'Build it in the open and ask the crew for review.', kind: 'do' },
      { title: 'Show it off', body: 'Post what you shipped in #show-and-tell. Completing a bounty finishes your mission.', kind: 'do' },
      { title: 'Submit your mission', body: 'Your mission completes when your bounty is approved.', kind: 'submit' },
    ],
  },
  {
    slug: 'create',
    tag: 'Create',
    title: 'Make the art + culture',
    summary: 'Posters, zines, mixtapes, films, merch. Make something and put it in front of the community.',
    position: 3,
    crewId: 'creative',
    missionTitle: 'Share something in #show-and-tell',
    stretchMissionTitles: ['Get featured in the Spotlight'],
    steps: [
      { title: 'Join a Creative crew call', body: 'Meet the people making the visuals and ask what is needed.', linkHref: '/crews', linkLabel: 'Find the Creative crew', kind: 'do' },
      { title: 'Read the brand system', body: 'Colors, type and tone, so your piece feels like PizzaDAO.', linkHref: '/brand-system', linkLabel: 'Brand system', kind: 'read' },
      { title: 'Make a piece', body: 'Poster, zine, short film, anything. Small and finished beats big and unfinished.', kind: 'do' },
      { title: 'Share it', body: 'Post it in #show-and-tell on Discord.\n\n[Open Discord]({{discordUrl}})', kind: 'do' },
      { title: 'Submit your mission', body: 'Submit the link to your Discord message.', kind: 'submit' },
    ],
  },
  {
    slug: 'gather',
    tag: 'Gather',
    title: 'Hold the room',
    summary: 'Long tables, slice clubs, coworking nights. Start a recurring ritual that turns strangers into regulars.',
    position: 4,
    crewId: 'community',
    missionTitle: 'Hold the room',
    stretchMissionTitles: ['Say hi on a call'],
    steps: [
      { title: 'Pick a format and a recurring slot', body: 'A weekly slice club, a monthly long table, a coworking night. Pick one and a day that repeats.', kind: 'do' },
      { title: 'Find a venue', body: 'The venue advice in the host guide applies here too.', linkHref: '/handbook/host-a-party#before', linkLabel: 'Venue and planning tips', kind: 'read' },
      { title: 'List it', body: 'Create an event page for the first date so people can find it.\n\n[Create the event]({{eventsUrl}})', kind: 'do' },
      { title: 'Tell the Community crew', body: 'Let the crew know so they can help spread the word.', linkHref: '/crews', linkLabel: 'Find the Community crew', kind: 'do' },
      { title: 'Run it twice', body: 'One event is a party; two is a ritual. Run it again.', kind: 'do' },
      { title: 'Submit your mission', body: 'Share the event listing or photos from your gatherings.', kind: 'submit' },
    ],
  },
  {
    slug: 'experiment',
    tag: 'Experiment',
    title: 'Run a hackathon',
    summary: 'Devs, designers and pizzaiolos, one weekend. Set the prompt, line up the pizza, judge the demos.',
    position: 5,
    crewId: 'events',
    missionTitle: 'Run a hackathon',
    stretchMissionTitles: ['Bounty hunter'],
    steps: [
      { title: 'Draft the prompt and the date', body: 'One clear prompt and a weekend. Keep it small enough to finish.', kind: 'do' },
      { title: 'Bring it to the crews', body: 'Pitch it on an Events crew call and a Tech crew call to get help and a venue.', linkHref: '/crews', linkLabel: 'Find the crews', kind: 'do' },
      { title: 'Sort the budget', body: 'Pizza and prizes cost money. Ask for it through the proposals process.', linkHref: '/proposals', linkLabel: 'Proposals', kind: 'do' },
      { title: 'Line up judges and prizes', body: 'Two or three judges and a few prizes are enough.', kind: 'do' },
      { title: 'Run it', body: 'Keep the schedule tight and the pizza coming.', kind: 'do' },
      { title: 'Post the demos', body: 'Share what people built so the work outlives the weekend.', kind: 'do' },
      { title: 'Submit your mission', body: 'Share the event page or a list of the demos.', kind: 'submit' },
    ],
  },
  {
    slug: 'grow',
    tag: 'Grow',
    title: 'Open a city',
    summary: 'Start a chapter where there is not one yet, then hand the keys to the next organizers.',
    position: 6,
    crewId: 'community',
    missionTitle: 'Open a city',
    stretchMissionTitles: ['Onboard a Bitcoin Pizza Day city'],
    steps: [
      { title: 'Check whether your city has a chapter', body: 'Look at the chapters on the community page. If yours exists, join it instead.', linkHref: '/community', linkLabel: 'Chapters', kind: 'read' },
      { title: 'Say hello in the regional channel', body: 'Introduce yourself and say which city you want to open.\n\n[Open Discord]({{discordUrl}})', kind: 'do' },
      { title: 'Host a first party', body: 'Follow the host lane to throw your first event.', linkHref: '/lanes/host', linkLabel: 'Host guide', kind: 'do' },
      { title: 'Recruit a co-organizer', body: 'A chapter run by two people survives a busy month.', kind: 'do' },
      { title: 'Hand over the keys', body: 'Show your co-organizer how to plan and announce the next event.', kind: 'do' },
      { title: 'Submit your mission', body: 'Share a link to your chapter channel or your first event.', kind: 'submit' },
    ],
  },
]

export interface ExistingMission {
  id: number
  title: string
}

export interface LaneSeedPlan {
  /** Lanes to insert (slug missing in the database), with mission ids resolved. */
  create: Array<{ lane: SeedLane; missionId: number | null; stretchMissionIds: number[] }>
  /** Lanes already in the database: never touched. */
  kept: string[]
  /** Mission titles that could not be found (the lane is seeded guide-only / without that stretch link). */
  missingMissions: string[]
}

/** Pure: what the seed would do. Mission titles match exactly, ignoring case and surrounding space. */
export function planLaneSeed(existingSlugs: string[], missions: ExistingMission[], lanes: SeedLane[] = SEED_LANES): LaneSeedPlan {
  const byTitle = new Map<string, number>()
  for (const m of missions) {
    const k = m.title.trim().toLowerCase()
    if (!byTitle.has(k)) byTitle.set(k, m.id)
  }
  const lookup = (title: string) => byTitle.get(title.trim().toLowerCase()) ?? null
  const have = new Set(existingSlugs)
  const plan: LaneSeedPlan = { create: [], kept: [], missingMissions: [] }
  for (const lane of lanes) {
    if (have.has(lane.slug)) {
      plan.kept.push(lane.slug)
      continue
    }
    const missionId = lookup(lane.missionTitle)
    if (missionId === null) plan.missingMissions.push(lane.missionTitle)
    const stretchMissionIds: number[] = []
    for (const t of lane.stretchMissionTitles) {
      const id = lookup(t)
      if (id === null) plan.missingMissions.push(t)
      else if (!stretchMissionIds.includes(id) && id !== missionId) stretchMissionIds.push(id)
    }
    plan.create.push({ lane, missionId, stretchMissionIds })
  }
  plan.missingMissions = [...new Set(plan.missingMissions)]
  return plan
}
