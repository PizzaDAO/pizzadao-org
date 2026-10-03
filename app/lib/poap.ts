import { AlchemyPOAP, POAPDisplayItem } from './poap-types';
import { GvizResponse, GvizCell } from './types/gviz';
import { cacheGet, cacheSet } from '../api/lib/cache';
import { fetchGviz } from './sheets/gviz';
import { SHEET_IDS } from './sheets/config';
import { fetchJsonCapped } from './mission-verify/net';

// POAP service layer - fetches and filters POAPs from POAP Compass API and Google Sheets

const POAP_CONTRACT = '0x22C1f6050E56d2876009903609a2cC3fEf83B415';
const POAP_WHITELIST_SHEET_ID = SHEET_IDS.poapWhitelist;

// Cache TTLs (in seconds)
const POAP_WHITELIST_REVALIDATE = 60 * 5; // Next data cache for the whitelist sheet
const POAP_USER_TTL = 0; // No expiry — POAPs are immutable, only new ones are fetched incrementally

// Cache structure for user POAPs
interface POAPCache {
  poaps: POAPDisplayItem[];
  totalCount: number;
  highestPoapId: number; // For incremental fetching
  lastUpdated: number;
  whitelistSize: number; // Track whitelist size to detect new POAP events
}

/**
 * Fetch allowed POAP event IDs from Google Sheets whitelist
 * Returns Set of event IDs (not token IDs - POAP events have multiple tokens)
 *
 * Sheet: SHEET_IDS.poapWhitelist
 * Column: "POAP ID" or numeric column with POAP event IDs
 *
 * Cached for 5 minutes in Next's data cache; pass `{ fresh: true }` to bypass.
 */
export async function fetchAllowedPOAPIds(opts: { fresh?: boolean } = {}): Promise<Set<string>> {
  try {
    let gviz: GvizResponse;
    try {
      gviz = await fetchGviz(
        POAP_WHITELIST_SHEET_ID,
        { headers: 0 },
        opts.fresh ? { fresh: true } : { revalidate: POAP_WHITELIST_REVALIDATE },
      );
    } catch (e) {
      console.error(`POAP whitelist fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return new Set();
    }
    const rows = gviz?.table?.rows || [];
    const cols = gviz?.table?.cols || [];

    // Strategy 1: Look for a header row with "POAP ID" or similar
    let poapIdIdx = -1;
    let startRow = 0;

    for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowVals = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || '').trim().toLowerCase()
      );

      // Look for "POAP ID" or "Event ID" column header
      const foundIdx = rowVals.findIndex(v =>
        (v.includes('poap') && v.includes('id')) ||
        (v.includes('event') && v.includes('id'))
      );

      if (foundIdx !== -1) {
        poapIdIdx = foundIdx;
        startRow = ri + 1;
        break;
      }
    }

    // Strategy 2: If no header found, look for a numeric column (type: number)
    // The POAP whitelist sheet has IDs in column D (index 3) with no header
    if (poapIdIdx === -1) {
      // Find the first numeric column
      for (let ci = 0; ci < cols.length; ci++) {
        if (cols[ci]?.type === 'number') {
          poapIdIdx = ci;
          startRow = 1; // Skip first row (likely headers even if empty)
          break;
        }
      }
    }

    // Strategy 3: Fallback - check column D (index 3) which is common for POAP sheets
    if (poapIdIdx === -1 && cols.length > 3) {
      poapIdIdx = 3;
      startRow = 1;
    }

    if (poapIdIdx === -1) {
      console.error('Could not locate POAP ID column in whitelist sheet');
      return new Set();
    }

    // Extract POAP IDs from rows
    const allowedIds = new Set<string>();
    for (let ri = startRow; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const cell = cells[poapIdIdx];
      // Handle both numeric values and string values
      const poapId = String(cell?.v ?? cell?.f ?? '').trim();

      // Only add valid numeric POAP IDs (they're typically 4-6 digit numbers)
      if (poapId && poapId !== '' && poapId !== '0' && /^\d+$/.test(poapId)) {
        allowedIds.add(poapId);
      }
    }

    return allowedIds;

  } catch (error) {
    console.error('Error fetching POAP whitelist:', error);
    return new Set();
  }
}

/**
 * Fetch user's POAPs using POAP Compass GraphQL API with pagination
 * POAPs live on Gnosis Chain (formerly xDai)
 * @param sinceId - Optional: only fetch POAPs with ID greater than this (for incremental updates)
 */
export async function fetchPOAPsFromAPI(walletAddress: string, sinceId?: number): Promise<AlchemyPOAP[]> {
  try {
    const POAP_COMPASS_URL = 'https://public.compass.poap.tech/v1/graphql';
    const PAGE_SIZE = 100;
    const allPoaps: AlchemyPOAP[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Build where clause - optionally filter by ID for incremental updates
      const whereClause = sinceId
        ? `{ collector_address: { _ilike: $address }, id: { _gt: ${sinceId} } }`
        : `{ collector_address: { _ilike: $address } }`;

      const query = `
        query GetPOAPs($address: String!, $limit: Int!, $offset: Int!) {
          poaps(
            where: ${whereClause}
            limit: $limit
            offset: $offset
            order_by: { id: desc }
          ) {
            id
            drop_id
            drop {
              name
              image_url
            }
          }
        }
      `;

      const res = await fetch(POAP_COMPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            address: walletAddress.toLowerCase(),
            limit: PAGE_SIZE,
            offset: offset,
          },
        }),
      });

      if (!res.ok) {
        console.error(`POAP Compass API error: ${res.status}`);
        break;
      }

      const data = await res.json();
      const poaps_data = data?.data?.poaps || [];

      // Transform Compass response to our format
      const poaps: AlchemyPOAP[] = poaps_data.map((poap: any) => ({
        tokenId: String(poap.id),
        contract: { address: POAP_CONTRACT },
        title: poap.drop?.name,
        image: {
          originalUrl: poap.drop?.image_url,
          cachedUrl: poap.drop?.image_url,
        },
        raw: {
          metadata: {
            name: poap.drop?.name,
            image: poap.drop?.image_url,
            attributes: [
              { trait_type: 'eventId', value: String(poap.drop_id) }
            ],
          },
        },
      }));

      allPoaps.push(...poaps);

      // Check if we got a full page (more results may exist)
      if (poaps_data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
      }

      // Safety limit (max 2000 POAPs)
      if (offset >= 2000) {
        hasMore = false;
      }
    }

    return allPoaps;

  } catch (error) {
    console.error('Error fetching POAPs from Compass API:', error);
    return [];
  }
}

/**
 * Transform Alchemy POAP to display format
 */
export function transformPOAP(nft: AlchemyPOAP): POAPDisplayItem | null {
  const tokenId = nft.tokenId;
  if (!tokenId) return null;

  // Extract event ID from POAP metadata (usually in attributes or description)
  // POAPs typically have eventId in attributes array
  let eventId = '';
  const attributes = nft.raw?.metadata?.attributes || [];
  const eventIdAttr = attributes.find(
    (attr) => attr.trait_type?.toLowerCase() === 'eventid' || attr.trait_type?.toLowerCase() === 'event_id'
  );
  eventId = eventIdAttr ? String(eventIdAttr.value) : '';

  // Fallback: some POAPs encode eventId differently
  // If not found in attributes, we can't filter by event - skip this POAP
  if (!eventId) {
    console.warn(`POAP token ${tokenId} has no eventId in metadata`);
    return null;
  }

  const title = nft.raw?.metadata?.name || nft.title || `POAP #${tokenId}`;
  const imageUrl =
    nft.image?.cachedUrl ||
    nft.image?.originalUrl ||
    nft.raw?.metadata?.image ||
    '';

  const poapGalleryUrl = `https://poap.gallery/event/${eventId}`;

  return {
    tokenId,
    eventId,
    title,
    imageUrl,
    poapGalleryUrl,
  };
}

/**
 * Main orchestration function: Fetch user's POAPs with incremental caching
 * Returns ALL whitelisted POAPs sorted by newest first
 */
export async function fetchFilteredPOAPs(walletAddress: string): Promise<{
  poaps: POAPDisplayItem[];
  totalCount: number;
  fromCache: boolean;
  debug?: {
    allowedEventIdsCount: number;
    rawPOAPsCount: number;
    newPOAPsCount: number;
  };
}> {
  const cacheKey = `poaps:${walletAddress.toLowerCase()}`;

  // Check persistent cache first
  const cached = await cacheGet<POAPCache>(cacheKey);

  if (cached) {
    // Only do an incremental update when the whitelist has grown (new POAP events added)
    const allowedEventIds = await fetchAllowedPOAPIds();

    if (allowedEventIds.size <= (cached.whitelistSize || 0)) {
      // Whitelist unchanged — cached data is complete
      return {
        poaps: cached.poaps,
        totalCount: cached.totalCount,
        fromCache: true,
      };
    }

    // Whitelist grew — fetch new POAPs since last cached ID
    try {
      const newRawPOAPs = await fetchPOAPsFromAPI(walletAddress, cached.highestPoapId);

      if (newRawPOAPs.length > 0) {
        // Transform and filter new POAPs
        const newPOAPs: POAPDisplayItem[] = [];
        for (const nft of newRawPOAPs) {
          const transformed = transformPOAP(nft);
          if (transformed && allowedEventIds.has(transformed.eventId)) {
            newPOAPs.push(transformed);
          }
        }

        // Merge with existing POAPs, dedup by tokenId
        const seen = new Set(newPOAPs.map(p => p.tokenId));
        const allPOAPs = [...newPOAPs, ...cached.poaps.filter(p => !seen.has(p.tokenId))];

        // Sort by token ID descending (newest first)
        allPOAPs.sort((a, b) => parseInt(b.tokenId, 10) - parseInt(a.tokenId, 10));

        // Find new highest ID
        const highestPoapId = Math.max(
          cached.highestPoapId,
          ...newRawPOAPs.map(p => parseInt(p.tokenId, 10))
        );

        // Update cache
        const newCache: POAPCache = {
          poaps: allPOAPs,
          totalCount: allPOAPs.length,
          highestPoapId,
          lastUpdated: Date.now(),
          whitelistSize: allowedEventIds.size,
        };
        await cacheSet(cacheKey, newCache, POAP_USER_TTL);

        return {
          poaps: allPOAPs,
          totalCount: allPOAPs.length,
          fromCache: false,
          debug: {
            allowedEventIdsCount: allowedEventIds.size,
            rawPOAPsCount: cached.poaps.length + newRawPOAPs.length,
            newPOAPsCount: newPOAPs.length,
          },
        };
      }

      // No new POAPs, just update whitelist size
      cached.lastUpdated = Date.now();
      cached.whitelistSize = allowedEventIds.size;
      await cacheSet(cacheKey, cached, POAP_USER_TTL);

      return {
        poaps: cached.poaps,
        totalCount: cached.totalCount,
        fromCache: true,
      };
    } catch (error) {
      // If incremental update fails, return cached data
      return {
        poaps: cached.poaps,
        totalCount: cached.totalCount,
        fromCache: true,
      };
    }
  }

  // No cache - do full fetch
  const allowedEventIds = await fetchAllowedPOAPIds();
  const rawPOAPs = await fetchPOAPsFromAPI(walletAddress);

  // Transform and filter
  const allPOAPs: POAPDisplayItem[] = [];
  let highestPoapId = 0;

  for (const nft of rawPOAPs) {
    const poapId = parseInt(nft.tokenId, 10);
    if (poapId > highestPoapId) highestPoapId = poapId;

    const transformed = transformPOAP(nft);
    if (!transformed) continue;

    if (allowedEventIds.has(transformed.eventId)) {
      allPOAPs.push(transformed);
    }
  }

  // Sort by token ID descending (newest first)
  allPOAPs.sort((a, b) => parseInt(b.tokenId, 10) - parseInt(a.tokenId, 10));

  // Cache the result
  const newCache: POAPCache = {
    poaps: allPOAPs,
    totalCount: allPOAPs.length,
    highestPoapId,
    lastUpdated: Date.now(),
    whitelistSize: allowedEventIds.size,
  };
  await cacheSet(cacheKey, newCache, POAP_USER_TTL);

  return {
    poaps: allPOAPs,
    totalCount: allPOAPs.length,
    fromCache: false,
    debug: {
      allowedEventIdsCount: allowedEventIds.size,
      rawPOAPsCount: rawPOAPs.length,
      newPOAPsCount: allPOAPs.length,
    },
  };
}

// ---------------------------------------------------------------------------
// One drop (mission verification, L4.1 "Make a POAP for a community call")
// ---------------------------------------------------------------------------

export const POAP_COMPASS_URL = 'https://public.compass.poap.tech/v1/graphql';

export interface PoapDropInfo {
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  /** Mints so far, when Compass answered the aggregate query; null otherwise. */
  mints: number | null;
  galleryUrl: string;
}

/**
 * Look up a POAP drop on the public POAP Compass GraphQL API (no API key,
 * like the rest of this file). Returns null when the drop doesn't exist and
 * 'unknown' when Compass can't be reached. Bounded: 4 s, 256 KB per request.
 * The drop's creator is not public (it is tied to a private email), so a
 * reviewer still confirms who made it.
 */
export async function fetchPoapDrop(
  dropId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PoapDropInfo | null | 'unknown'> {
  if (!Number.isInteger(dropId) || dropId < 1 || dropId > 1e9) return null;
  const post = (query: string) =>
    fetchJsonCapped<{ data?: Record<string, unknown>; errors?: unknown }>(fetchImpl, POAP_COMPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

  // Inline id (the whitelist route found variables unreliable with the bigint type).
  const res = await post(
    `query { drops(where: { id: { _eq: ${dropId} } }, limit: 1) { id name description image_url start_date end_date city country } }`,
  );
  if (!res || !res.ok || !res.json || res.json.errors) return 'unknown';
  const drops = (res.json.data?.drops ?? []) as Array<Record<string, unknown>>;
  const d = drops[0];
  if (!d) return null;

  let mints: number | null = null;
  const agg = await post(`query { poaps_aggregate(where: { drop_id: { _eq: ${dropId} } }) { aggregate { count } } }`);
  const count = (agg?.json?.data?.poaps_aggregate as { aggregate?: { count?: unknown } } | undefined)?.aggregate?.count;
  if (typeof count === 'number') mints = count;

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: Number(d.id),
    name: str(d.name) ?? `POAP #${dropId}`,
    description: (str(d.description) ?? '').slice(0, 500),
    imageUrl: str(d.image_url),
    startDate: str(d.start_date),
    endDate: str(d.end_date),
    city: str(d.city),
    country: str(d.country),
    mints,
    galleryUrl: `https://poap.gallery/drops/${dropId}`,
  };
}
