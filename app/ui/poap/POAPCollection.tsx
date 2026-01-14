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

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-3">POAPs</h3>

      {loading ? (
        // Loading shimmer
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg bg-gray-200 animate-pulse"
            />
          ))}
        </div>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {/* Oldest POAP */}
              {data.poaps[0] && <POAPCard poap={data.poaps[0]} />}

              {/* Hidden count indicator */}
              {data.hiddenCount > 0 && (
                <div className="aspect-square rounded-lg border border-dashed border-gray-300 flex items-center justify-center bg-gray-50">
                  <div className="text-center px-2">
                    <p className="text-2xl font-bold text-gray-400">{data.hiddenCount}</p>
                    <p className="text-xs text-gray-500 mt-1">hidden</p>
                  </div>
                </div>
              )}

              {/* 10 Newest POAPs */}
              {data.poaps.slice(1).map((poap) => (
                <POAPCard key={poap.tokenId} poap={poap} />
              ))}
            </div>

            {/* Total count footer */}
            <p className="text-sm text-gray-500 mt-3">
              {data.totalCount === 1
                ? '1 POAP'
                : `${data.totalCount} POAPs`}
              {data.hiddenCount > 0 && ` (${data.poaps.length} shown)`}
            </p>
          </>
        )
      )}
    </div>
  );
}
