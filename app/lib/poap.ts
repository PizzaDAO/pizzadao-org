import { AlchemyPOAP, POAPDisplayItem } from './poap-types';
import { parseGvizJson } from './gviz-parser';
import { findColumnIndex } from './sheet-utils';
import { GvizResponse, GvizCell } from './types/gviz';

// POAP service layer - fetches and filters POAPs from Alchemy API and Google Sheets

const POAP_CONTRACT = '0x22C1f6050E56d2876009903609a2cC3fEf83B415';
const POAP_WHITELIST_SHEET_ID = '1UsQA1Jqm4gCb1qMwWf7i_k0eNsi5EofyOjijmGig3Jc';

// In-memory cache with TTL (same pattern as app/api/nfts/leaderboard/route.ts)
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet(key: string, data: unknown): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

/**
 * Fetch allowed POAP event IDs from Google Sheets whitelist
 * Returns Set of event IDs (not token IDs - POAP events have multiple tokens)
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1UsQA1Jqm4gCb1qMwWf7i_k0eNsi5EofyOjijmGig3Jc
 * Column: "POAP ID"
 */
export async function fetchAllowedPOAPIds(): Promise<Set<string>> {
  // Check cache first
  const cached = cacheGet<Set<string>>('poap-allowed-ids');
  if (cached) return cached;

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

    // Find header row
    let headerRowIdx = -1;
    let headerVals: string[] = [];

    for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowVals = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || '').trim().toLowerCase()
      );

      // Look for "POAP ID" column
      if (rowVals.some(v => v.includes('poap') && v.includes('id'))) {
        headerRowIdx = ri;
        headerVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || '').trim());
        break;
      }
    }

    if (headerRowIdx === -1) {
      console.error('POAP ID column not found in whitelist sheet');
      return new Set();
    }

    // Find POAP ID column index
    const poapIdIdx = findColumnIndex(headerVals, ['poap id', 'poapid', 'poap_id', 'event id', 'eventid']);

    if (poapIdIdx == null) {
      console.error('Could not locate POAP ID column');
      return new Set();
    }

    // Extract POAP IDs from rows
    const allowedIds = new Set<string>();
    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const poapId = String(cells[poapIdIdx]?.v ?? cells[poapIdIdx]?.f ?? '').trim();

      if (poapId && poapId !== '' && poapId !== '0') {
        allowedIds.add(poapId);
      }
    }

    // Cache the result
    cacheSet('poap-allowed-ids', allowedIds);
    return allowedIds;

  } catch (error) {
    console.error('Error fetching POAP whitelist:', error);
    return new Set();
  }
}

/**
 * Fetch user's POAPs from Alchemy API
 * Returns all POAPs (unfiltered) from the POAP contract
 */
export async function fetchPOAPsFromAlchemy(walletAddress: string): Promise<AlchemyPOAP[]> {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    console.error('ALCHEMY_API_KEY not configured');
    return [];
  }

  try {
    // Alchemy getNFTsForOwner endpoint
    const url = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}/getNFTsForOwner`;
    const params = new URLSearchParams({
      owner: walletAddress,
      'contractAddresses[]': POAP_CONTRACT,
      withMetadata: 'true',
      pageSize: '100', // Max 100 per page
    });

    const res = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.error(`Alchemy API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const nfts: AlchemyPOAP[] = data?.ownedNfts || [];

    // Handle pagination if needed (unlikely with POAPs, but good practice)
    // For now, return first 100 POAPs (most users have < 100)
    return nfts;

  } catch (error) {
    console.error('Error fetching POAPs from Alchemy:', error);
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
 * Main orchestration function: Fetch user's POAPs, filter by whitelist, select oldest + 10 newest
 */
export async function fetchFilteredPOAPs(walletAddress: string): Promise<{
  poaps: POAPDisplayItem[];
  totalCount: number;
  hiddenCount: number;
}> {
  // Check cache
  const cacheKey = `poaps:${walletAddress.toLowerCase()}`;
  const cached = cacheGet<{ poaps: POAPDisplayItem[]; totalCount: number; hiddenCount: number }>(cacheKey);
  if (cached) return cached;

  // 1. Fetch whitelist
  const allowedEventIds = await fetchAllowedPOAPIds();

  // 2. Fetch user's POAPs from Alchemy
  const rawPOAPs = await fetchPOAPsFromAlchemy(walletAddress);

  // 3. Transform and filter
  const allPOAPs: POAPDisplayItem[] = [];
  for (const nft of rawPOAPs) {
    const transformed = transformPOAP(nft);
    if (!transformed) continue;

    // Filter: only include if eventId is in whitelist
    if (allowedEventIds.has(transformed.eventId)) {
      allPOAPs.push(transformed);
    }
  }

  // 4. Sort by token ID ascending (oldest first)
  allPOAPs.sort((a, b) => {
    const aId = parseInt(a.tokenId, 10);
    const bId = parseInt(b.tokenId, 10);
    return aId - bId;
  });

  const totalCount = allPOAPs.length;

  // 5. Select POAPs to display
  let selectedPOAPs: POAPDisplayItem[] = [];

  if (totalCount <= 11) {
    // Show all
    selectedPOAPs = allPOAPs;
  } else {
    // Show oldest (index 0) + 10 newest (last 10)
    const oldest = allPOAPs[0];
    const newest10 = allPOAPs.slice(-10);
    selectedPOAPs = [oldest, ...newest10];
  }

  const hiddenCount = totalCount - selectedPOAPs.length;

  const result = {
    poaps: selectedPOAPs,
    totalCount,
    hiddenCount,
  };

  // Cache the result
  cacheSet(cacheKey, result);

  return result;
}
