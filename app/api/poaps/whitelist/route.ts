import { NextResponse } from 'next/server';
import { fetchAllowedPOAPIds } from '@/app/lib/poap';
import { cacheGet, cacheSet } from '@/app/api/lib/cache';

// Cache TTL for whitelist with event details (7 days)
const WHITELIST_DETAILS_TTL = 60 * 60 * 24 * 7;

interface POAPEvent {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  eventUrl: string;
}

interface WhitelistResponse {
  events: POAPEvent[];
  totalCount: number;
  fromCache: boolean;
}

/**
 * Fetch POAP event details from POAP Compass API
 */
async function fetchPOAPEventDetails(eventIds: string[]): Promise<POAPEvent[]> {
  const POAP_COMPASS_URL = 'https://public.compass.poap.tech/v1/graphql';

  // Fetch in batches of 50 to avoid query size limits
  const BATCH_SIZE = 50;
  const allEvents: POAPEvent[] = [];

  for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
    const batchIds = eventIds.slice(i, i + BATCH_SIZE);
    const idsArray = batchIds.map(id => parseInt(id, 10)).join(', ');

    // Use inline IDs in query (more reliable than variables with bigint type)
    const query = `
      query {
        drops(where: { id: { _in: [${idsArray}] } }, limit: ${BATCH_SIZE}) {
          id
          name
          description
          image_url
          start_date
          end_date
          city
          country
          event_url
        }
      }
    `;

    try {
      const res = await fetch(POAP_COMPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        console.error(`POAP Compass API error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const drops = data?.data?.drops || [];

      for (const drop of drops) {
        allEvents.push({
          id: String(drop.id),
          name: drop.name || `POAP #${drop.id}`,
          description: drop.description || '',
          imageUrl: drop.image_url || '',
          startDate: drop.start_date || '',
          endDate: drop.end_date || '',
          city: drop.city || '',
          country: drop.country || '',
          eventUrl: drop.event_url || `https://poap.gallery/event/${drop.id}`,
        });
      }
    } catch (error) {
      console.error('Error fetching POAP event details:', error);
    }
  }

  return allEvents;
}

/**
 * GET /api/poaps/whitelist
 * Returns all whitelisted POAP events with their details
 */
export async function GET(): Promise<NextResponse<WhitelistResponse>> {
  // Check cache first
  const cached = await cacheGet<WhitelistResponse>('poap-whitelist-details');
  if (cached) {
    return NextResponse.json({ ...cached, fromCache: true });
  }

  try {
    // Get whitelist IDs
    const allowedIds = await fetchAllowedPOAPIds();
    const eventIds = Array.from(allowedIds);

    if (eventIds.length === 0) {
      return NextResponse.json({
        events: [],
        totalCount: 0,
        fromCache: false,
      });
    }

    // Fetch event details
    const events = await fetchPOAPEventDetails(eventIds);

    // Sort by start date descending (newest first)
    events.sort((a, b) => {
      const dateA = new Date(a.startDate).getTime() || 0;
      const dateB = new Date(b.startDate).getTime() || 0;
      return dateB - dateA;
    });

    const result: WhitelistResponse = {
      events,
      totalCount: events.length,
      fromCache: false,
    };

    // Cache the result
    await cacheSet('poap-whitelist-details', result, WHITELIST_DETAILS_TTL);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching whitelist details:', error);
    return NextResponse.json({
      events: [],
      totalCount: 0,
      fromCache: false,
    });
  }
}
