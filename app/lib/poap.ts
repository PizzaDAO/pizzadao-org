import { AlchemyPOAP, POAPDisplayItem } from './poap-types';
import { parseGvizJson } from './gviz-parser';
import { findColumnIndex } from './sheet-utils';
import { GvizResponse, GvizCell } from './types/gviz';
import { cacheGet, cacheSet, cacheGetOrSet } from '../api/lib/cache';

// POAP service layer - fetches and filters POAPs from POAP Compass API and Google Sheets

const POAP_CONTRACT = '0x22C1f6050E56d2876009903609a2cC3fEf83B415';
const POAP_WHITELIST_SHEET_ID = '1UsQA1Jqm4gCb1qMwWf7i_k0eNsi5EofyOjijmGig3Jc';

// Cache TTLs (in seconds)
const POAP_WHITELIST_TTL = 60 * 60 * 24 * 7; // 7 days - whitelist rarely changes
const POAP_USER_TTL = 60 * 60 * 24 * 7; // 7 days - POAPs don't change often, incremental updates handle new ones

// Cache structure for user POAPs
interface POAPCache {
  poaps: POAPDisplayItem[];
  totalCount: number;
  highestPoapId: number; // For incremental fetching
  lastUpdated: number;
}

/**
 * Fetch allowed POAP event IDs from Google Sheets whitelist
 * Returns Set of event IDs (not token IDs - POAP events have multiple tokens)
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1UsQA1Jqm4gCb1qMwWf7i_k0eNsi5EofyOjijmGig3Jc
 * Column: "POAP ID" or numeric column with POAP event IDs
 */
export async function fetchAllowedPOAPIds(): Promise<Set<string>> {
  // Check persistent cache first
  const cached = await cacheGet<string[]>('poap-whitelist-ids');
  if (cached) return new Set(cached);

  try {
    const url = `https://docs.google.com/spreadsheets/d/${POAP_WHITELIST_SHEET_ID}/gviz/tq?tqx=out:json&headers=0`;
    const res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      console.error(`POAP whitelist fetch failed: ${res.status}`);
      return new Set();
    }

    const text = await res.text();
    const gviz: GvizResponse = parseGvizJson(text);
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

    // Cache the result (store as array since Set doesn't serialize well)
    await cacheSet('poap-whitelist-ids', Array.from(allowedIds), POAP_WHITELIST_TTL);
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
    // Return cached data immediately - it's always fresh enough
    // Check if we should do an incremental update (every 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    if (cached.lastUpdated > fiveMinutesAgo) {
      // Cache is fresh, return as-is
      return {
        poaps: cached.poaps,
        totalCount: cached.totalCount,
        fromCache: true,
      };
    }

    // Cache exists but is older than 5 min - do incremental update
    try {
      const allowedEventIds = await fetchAllowedPOAPIds();
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

        // Merge with existing POAPs
        const allPOAPs = [...newPOAPs, ...cached.poaps];

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

      // No new POAPs, just update timestamp
      cached.lastUpdated = Date.now();
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
