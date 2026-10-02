// Shared editorial primitives for index pages (crews, calls, chats, vouches,
// turtles, manuals, nfts, poaps). Same vocabulary as the hand-built mastheads
// on /articles, /missions and /pep: tomato "§ ···" overline, display-font
// headline sized with clamp(), a short dek, and a thick + hairline rule pair.

import type { ReactNode } from "react";

/** Paper card surface: warm hairline border, soft paper grain, card fill. */
export const paperCard =
  "paper-soft rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.55)] bg-card text-card-foreground";

/** Outline pill button (secondary actions, pagination). */
export const pillOutline =
  "btn-pill min-h-11 bg-transparent text-foreground border border-[hsl(var(--foreground)/0.25)] hover:bg-[hsl(var(--foreground)/0.06)] no-underline";

/** Solid ink pill button (primary actions). */
export const pillInk =
  "btn-pill min-h-11 bg-foreground text-background border border-transparent hover:opacity-90 no-underline";

/** Tomato pill button (loud CTA). */
export const pillTomato =
  "btn-pill min-h-11 bg-tomato text-cream border border-transparent hover:opacity-90 no-underline";

export function EditorialMasthead({
  overline,
  title,
  dek,
  aside,
  children,
}: {
  /** Short section label, rendered as "§ ··· {overline}". */
  overline: string;
  title: ReactNode;
  dek?: ReactNode;
  /** Right-hand slot (CTA, refresh button…), wraps under the title on mobile. */
  aside?: ReactNode;
  /** Extra content between the dek and the rules (e.g. nav pills). */
  children?: ReactNode;
}) {
  return (
    <header className="relative fade-up mb-8">
      <p className="overline text-tomato m-0">
        <span aria-hidden>§</span>
        <span aria-hidden className="mx-2 opacity-50">
          ···
        </span>
        {overline}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1
            className="font-display font-black tracking-[-0.015em] text-foreground leading-[0.95] m-0"
            style={{ fontSize: "clamp(2.4rem, 7vw, 4.6rem)", textWrap: "balance" }}
          >
            {title}
          </h1>
          {dek && (
            <p
              className="mt-4 mb-0 max-w-xl text-foreground/70"
              style={{ fontSize: 15, lineHeight: 1.55, textWrap: "pretty" }}
            >
              {dek}
            </p>
          )}
        </div>
        {aside && <div className="relative shrink-0">{aside}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
      <div className="rule-thick mt-8" />
      <div className="rule mt-1" />
    </header>
  );
}

/** Small section header: muted overline + display h2 + optional count. */
export function SectionHeading({
  overline,
  title,
  count,
  as: Tag = "h2",
}: {
  overline?: string;
  title: ReactNode;
  count?: number;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-3">
      {overline && <p className="overline text-foreground/45 m-0">{overline}</p>}
      <Tag className="font-display text-xl md:text-2xl font-black tracking-tight text-foreground mt-1 mb-0">
        {title}
        {count !== undefined && (
          <span className="ml-2 align-middle inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-[hsl(var(--butter)/0.35)] text-foreground text-[11px] font-bold tabular-nums">
            {count}
          </span>
        )}
      </Tag>
    </div>
  );
}

/** Filter chip used by the calls / chats filter strips. */
export function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 px-3 py-1.5 rounded-full text-[13px] font-semibold border cursor-pointer transition-colors ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card text-foreground border-[hsl(var(--rule-warm)/0.65)] hover:border-[hsl(var(--tomato)/0.6)]"
      }`}
    >
      {label}
    </button>
  );
}

/** Dashed paper empty state with display headline. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="paper-soft rounded-[var(--radius)] border-2 border-dashed border-[hsl(var(--rule-warm)/0.65)] bg-card p-8 text-center">
      <p className="font-display text-lg font-black text-foreground m-0">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Centered loading line in overline type. */
export function LoadingLine({ label }: { label: string }) {
  return (
    <div className="grid place-items-center py-24" role="status" aria-live="polite">
      <span
        aria-hidden
        className="block h-10 w-10 rounded-full border-4 border-[hsl(var(--ink)/0.10)] border-t-tomato animate-spin mb-4"
      />
      <p className="overline text-muted-foreground m-0">§ {label}</p>
    </div>
  );
}

/** Page shell: background, gutters, max width. */
export function EditorialPage({
  children,
  width = "max-w-[1100px]",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="relative min-h-screen bg-background text-foreground px-4 sm:px-5 py-10">
      <div className={`mx-auto ${width}`}>{children}</div>
    </div>
  );
}
