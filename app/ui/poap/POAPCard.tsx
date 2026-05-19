'use client';

import { POAPDisplayItem } from '@/app/lib/poap-types';

interface POAPCardProps {
  poap: POAPDisplayItem;
  size?: 'small' | 'large';
}

/**
 * POAPCard — capers-48272 (Phase 4e restyle)
 * Cream surface, ink-tinted border, tomato hover ring. Uses raw HSL tokens
 * from globals.css via Tailwind utilities (border-rule, hover:border-tomato).
 */
export function POAPCard({ poap, size = 'large' }: POAPCardProps) {
  if (size === 'small') {
    return (
      <a
        href={poap.poapGalleryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 rounded-full overflow-hidden border border-rule bg-muted hover:border-tomato hover:shadow-md transition-all duration-200 flex-shrink-0"
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
          <div className="w-full h-full bg-muted" />
        )}
      </a>
    );
  }

  return (
    <a
      href={poap.poapGalleryUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square rounded-[var(--radius)] overflow-hidden border border-rule bg-muted hover:border-tomato hover:shadow-md transition-all duration-200"
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
        <div className="w-full h-full bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-xs text-center px-2 italic">No Image</span>
        </div>
      )}

      {/* Hover overlay with title */}
      <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/70 transition-all duration-200 flex items-end">
        <div className="p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <p className="text-cream text-xs font-medium line-clamp-2 font-display">{poap.title}</p>
        </div>
      </div>
    </a>
  );
}
