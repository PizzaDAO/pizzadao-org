'use client';

import { POAPDisplayItem } from '@/app/lib/poap-types';

interface POAPCardProps {
  poap: POAPDisplayItem;
  size?: 'small' | 'large';
}

export function POAPCard({ poap, size = 'large' }: POAPCardProps) {
  if (size === 'small') {
    return (
      <a
        href={poap.poapGalleryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 hover:border-yellow-400 transition-all duration-200 flex-shrink-0"
        title={poap.title}
      >
        {poap.imageUrl ? (
          <img
            src={poap.imageUrl}
            alt={poap.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gray-100" />
        )}
      </a>
    );
  }

  return (
    <a
      href={poap.poapGalleryUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-yellow-400 transition-all duration-200"
      title={poap.title}
    >
      {poap.imageUrl ? (
        <img
          src={poap.imageUrl}
          alt={poap.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <span className="text-gray-400 text-xs text-center px-2">No Image</span>
        </div>
      )}

      {/* Hover overlay with title */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/70 transition-all duration-200 flex items-end">
        <div className="p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <p className="text-white text-xs font-medium line-clamp-2">{poap.title}</p>
        </div>
      </div>
    </a>
  );
}
