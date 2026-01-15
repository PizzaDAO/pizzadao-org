'use client';

import { useEffect, useState } from 'react';
import { POAPCollectionResponse } from '@/app/lib/poap-types';
import { POAPCard } from './POAPCard';

interface POAPCollectionProps {
  memberId: string;
}

export function POAPCollection({ memberId }: POAPCollectionProps) {
  const [data, setData] = useState<POAPCollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchPOAPs() {
      try {
        setLoading(true);
        setError(false);

        const res = await fetch(`/api/poaps/${memberId}`);

        if (!res.ok) {
          throw new Error('Failed to fetch POAPs');
        }

        const result: POAPCollectionResponse = await res.json();
        setData(result);
      } catch (err) {
        console.error('Error fetching POAPs:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    if (memberId) {
      fetchPOAPs();
    }
  }, [memberId]);

  // Hide section if no wallet or error
  if (error || data?.noWallet) {
    return null;
  }

  // Hide section if no POAPs
  if (!loading && data && data.totalCount === 0) {
    return null;
  }

  // Calculate what to show
  const totalCount = data?.totalCount || 0;
  const allPoaps = data?.poaps || [];
  const hasHidden = totalCount > 14; // More than 13 newest + 1 oldest
  const hiddenCount = hasHidden ? totalCount - 14 : 0;

  // Split POAPs: newest 13, hidden middle, oldest 1
  const newest13 = allPoaps.slice(0, 13);
  const oldest1 = allPoaps.length > 0 ? [allPoaps[allPoaps.length - 1]] : [];
  const middlePoaps = allPoaps.slice(13, -1); // Everything between newest 13 and oldest 1

  return (
    <div className="mt-4">
      <a
        href="/poaps"
        className="text-sm font-medium text-gray-500 hover:text-yellow-600 mb-2 inline-block transition-colors"
      >
        POAPs {data && `(${data.totalCount})`} →
      </a>

      {loading ? (
        // Loading shimmer
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="w-10 h-10 rounded-full bg-gray-200 animate-pulse flex-shrink-0"
            />
          ))}
        </div>
      ) : (
        data && (
          <div className="flex flex-wrap items-center gap-2">
            {/* 13 Newest POAPs */}
            {newest13.map((poap) => (
              <POAPCard key={poap.tokenId} poap={poap} size="small" />
            ))}

            {/* Hidden count badge - clickable to expand */}
            {hasHidden && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 hover:border-yellow-400 flex items-center justify-center bg-gray-50 hover:bg-yellow-50 flex-shrink-0 transition-colors cursor-pointer"
                title={`Show ${hiddenCount} more POAPs`}
              >
                <span className="text-xs font-bold text-gray-500">+{hiddenCount}</span>
              </button>
            )}

            {/* Middle POAPs - shown when expanded */}
            {expanded && middlePoaps.map((poap) => (
              <POAPCard key={poap.tokenId} poap={poap} size="small" />
            ))}

            {/* Oldest POAP */}
            {oldest1.map((poap) => (
              <POAPCard key={poap.tokenId} poap={poap} size="small" />
            ))}

            {/* Collapse button when expanded */}
            {expanded && hasHidden && (
              <button
                onClick={() => setExpanded(false)}
                className="w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-400 flex items-center justify-center bg-gray-100 hover:bg-gray-200 flex-shrink-0 transition-colors cursor-pointer"
                title="Show less"
              >
                <span className="text-xs font-bold text-gray-500">−</span>
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
