import { NextResponse } from 'next/server';
import { fetchAllowedPOAPIds } from '@/app/lib/poap';
import { cacheGet, cacheSet, cacheDel } from '@/app/api/lib/cache';

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
async function fetchPOAPEventDetails(eventIds: string[]): Promise<{ events: POAPEvent[]; debugLog: string[] }> {
  const POAP_COMPASS_URL = 'https://public.compass.poap.tech/v1/graphql';

  // Fetch in batches of 50 to avoid query size limits
  const BATCH_SIZE = 50;
  const allEvents: POAPEvent[] = [];
  const debugLog: string[] = [];

  for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
    const batchIds = eventIds.slice(i, i + BATCH_SIZE);
    const idsArray = batchIds.map(id => parseInt(id, 10)).join(', ');

    // Use inline IDs in query (more reliable than variables with bigint type)
    // Note: event_url is not a valid field - we construct it from the ID
    const query = `query { drops(where: { id: { _in: [${idsArray}] } }, limit: ${BATCH_SIZE}) { id name description image_url start_date end_date city country } }`;

    try {
      const res = await fetch(POAP_COMPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      const responseText = await res.text();
      debugLog.push(`Batch ${i / BATCH_SIZE}: status=${res.status}, len=${responseText.length}`);

      if (!res.ok) {
        debugLog.push(`Error: ${responseText.slice(0, 200)}`);
        continue;
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        debugLog.push(`Parse error: ${responseText.slice(0, 200)}`);
        continue;
      }

      if (data.errors) {
        debugLog.push(`GraphQL errors: ${JSON.stringify(data.errors).slice(0, 200)}`);
      }

      const drops = data?.data?.drops || [];
      debugLog.push(`Batch ${i / BATCH_SIZE}: got ${drops.length} drops`);

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

      // Rate limit: wait 100ms between batches
      if (i + BATCH_SIZE < eventIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      debugLog.push(`Exception: ${error}`);
    }
  }

  return { events: allEvents, debugLog };
}

/**
 * GET /api/poaps/whitelist
 * Returns all whitelisted POAP events with their details
 * Use ?fresh=1 to bypass cache
 */
export async function GET(req: Request): Promise<NextResponse<WhitelistResponse>> {
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get('fresh') === '1';

  // Clear caches if force refresh
  if (forceRefresh) {
    await cacheDel('poap-whitelist-details');
    await cacheDel('poap-whitelist-ids');
  }

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await cacheGet<WhitelistResponse>('poap-whitelist-details');
    if (cached && cached.events && cached.events.length > 0) {
      return NextResponse.json({ ...cached, fromCache: true });
    }
  }

  try {
    // Get whitelist IDs (will fetch fresh since we cleared the cache)
    const allowedIds = await fetchAllowedPOAPIds();
    const eventIds = Array.from(allowedIds);

    // Debug: show first few IDs
    const debugInfo = {
      idsCount: eventIds.length,
      sampleIds: eventIds.slice(0, 5),
    };

    if (eventIds.length === 0) {
      return NextResponse.json({
        events: [],
        totalCount: 0,
        fromCache: false,
        debug: { message: 'No whitelist IDs found', ...debugInfo },
      } as any);
    }

    // Fetch event details
    const { events, debugLog } = await fetchPOAPEventDetails(eventIds);

    // Sort by start date descending (newest first)
    events.sort((a, b) => {
      const dateA = new Date(a.startDate).getTime() || 0;
      const dateB = new Date(b.startDate).getTime() || 0;
      return dateB - dateA;
    });

    const result = {
      events,
      totalCount: events.length,
      fromCache: false,
      debug: {
        ...debugInfo,
        eventsReturned: events.length,
        fetchLog: debugLog,
      },
    };

    // Only cache if we got events
    if (events.length > 0) {
      await cacheSet('poap-whitelist-details', { events, totalCount: events.length, fromCache: false }, WHITELIST_DETAILS_TTL);
    }

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
