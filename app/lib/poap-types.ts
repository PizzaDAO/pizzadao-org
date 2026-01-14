/**
 * POAP (Proof of Attendance Protocol) type definitions
 * Display format for POAPs shown on user profiles and dashboard
 */

/**
 * Display format for a single POAP
 */
export interface POAPDisplayItem {
  tokenId: string;           // e.g., "123456"
  eventId: string;            // e.g., "87654"
  title: string;              // Event name from metadata
  imageUrl: string;           // POAP image URL
  poapGalleryUrl: string;     // Link to POAP.gallery page
}

/**
 * API response from /api/poaps/[memberId]
 */
export interface POAPCollectionResponse {
  poaps: POAPDisplayItem[];   // Oldest + 10 newest (max 11 items)
  totalCount: number;         // Total POAPs user owns (after whitelist filtering)
  hiddenCount: number;        // Number of POAPs not shown (totalCount - poaps.length)
  walletAddress: string;      // Wallet address used for lookup
  noWallet?: boolean;         // True if member has no wallet address
}

/**
 * Internal: Raw POAP from Alchemy API
 */
export interface AlchemyPOAP {
  tokenId: string;
  contract: {
    address: string;
  };
  title?: string;
  description?: string;
  image?: {
    originalUrl?: string;
    cachedUrl?: string;
  };
  raw?: {
    metadata?: {
      name?: string;
      image?: string;
      attributes?: Array<{ trait_type: string; value: string | number }>;
    };
  };
}
