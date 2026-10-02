"use client";

// Editorial restyle: § overline + display-font title, paper-soft content
// sheet with an overline table header. Fetching and content are unchanged.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EditorialPage, paperCard, pillInk } from "@/app/ui/shared/Editorial";

type Manual = {
  title: string;
  url: string | null;
  crew: string;
  crewId: string;
  status: string;
  authorId: string;
  author: string;
  lastUpdated: string;
  notes: string;
};

type CellData = {
  value: string;
  url: string | null;
};

type SheetContent = {
  headers: string[];
  rows: CellData[][];
};

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "complete" || s === "completed") {
    return "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_65%)]";
  }
  if (s === "draft") {
    return "bg-[hsl(var(--butter)/0.35)] text-[hsl(var(--ink))] dark:text-[hsl(var(--butter))]";
  }
  if (s === "needed") {
    return "bg-[hsl(var(--tomato)/0.15)] text-tomato";
  }
  if (s === "backlog") {
    return "bg-[hsl(258_90%_66%/0.15)] text-[hsl(262_60%_45%)] dark:text-[hsl(258_90%_75%)]";
  }
  return "bg-[hsl(var(--ink)/0.08)] text-muted-foreground";
}

export default function ManualDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [manual, setManual] = useState<Manual | null>(null);
  const [sheetContent, setSheetContent] = useState<SheetContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchManual() {
      try {
        const res = await fetch(`/api/manuals/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Manual not found");
          }
          throw new Error("Failed to fetch manual");
        }
        const data = await res.json();
        setManual(data.manual);
        setSheetContent(data.sheetContent);
        setContentError(data.contentError || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchManual();
    }
  }, [id]);

  return (
    <EditorialPage width="max-w-[1000px]">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/manuals"
          className="overline inline-flex items-center min-h-11 text-foreground/55 no-underline hover:text-tomato transition-colors"
        >
          &#8592; Back to manuals
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div className={`${paperCard} p-6`}>
          <div className="h-8 w-3/5 mb-4 rounded-md bg-[hsl(var(--ink)/0.08)] animate-pulse" />
          <div className="h-[200px] rounded-md bg-[hsl(var(--ink)/0.08)] animate-pulse" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className={`${paperCard} p-10 text-center grid justify-items-center gap-4`}>
          <p className="text-base text-destructive m-0">{error}</p>
          <Link href="/manuals" className={pillInk}>
            Back to manuals
          </Link>
        </div>
      )}

      {/* Manual content */}
      {!loading && !error && manual && (
        <article>
          {/* Manual header */}
          <header className="fade-up mb-6">
            <p className="overline text-tomato m-0">
              <span aria-hidden>§</span>
              <span aria-hidden className="mx-2 opacity-50">···</span>
              {manual.crew ? `${manual.crew} · Manual` : "Manual"}
            </p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <h1
                className="font-display font-black tracking-[-0.015em] text-foreground leading-[0.98] m-0 min-w-0"
                style={{ fontSize: "clamp(2rem, 5.5vw, 3.4rem)", textWrap: "balance" }}
              >
                {manual.title}
              </h1>
              {manual.status && (
                <span
                  className={`overline shrink-0 px-2.5 py-1 rounded-md mt-2 ${statusBadgeClass(manual.status)}`}
                  style={{ fontSize: 10.5 }}
                >
                  {manual.status}
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {manual.crew && (
                <Link href={`/crew/${manual.crewId}`} className="text-tomato no-underline hover:underline">
                  {manual.crew}
                </Link>
              )}
              {manual.author && manual.authorId && (
                <span>
                  by{" "}
                  <Link href={`/profile/${manual.authorId}`} className="text-tomato no-underline hover:underline">
                    {manual.author}
                  </Link>
                </span>
              )}
              {manual.author && !manual.authorId && <span>by {manual.author}</span>}
              {manual.lastUpdated && <span>Updated: {manual.lastUpdated}</span>}
            </div>
            {manual.url && (
              <a
                href={manual.url}
                target="_blank"
                rel="noopener noreferrer"
                className="overline mt-3 inline-flex items-center min-h-11 text-tomato no-underline hover:underline"
              >
                Open in Google Sheets &#8594;
              </a>
            )}
            <div className="rule-thick mt-5" />
            <div className="rule mt-1" />
          </header>

          {/* Manual content - Sheet data displayed as table */}
          <div className={`${paperCard} overflow-hidden`} style={{ boxShadow: "var(--shadow-soft)" }}>
            {sheetContent && sheetContent.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {/* Step number column */}
                      <th className="overline text-center px-4 py-3 border-b-2 border-foreground/80 whitespace-nowrap w-[50px] text-foreground/60">
                        #
                      </th>
                      {sheetContent.headers.map((header, i) => (
                        <th
                          key={i}
                          className="overline text-left px-4 py-3 border-b-2 border-foreground/80 whitespace-nowrap text-foreground/60"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetContent.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-[hsl(var(--butter)/0.10)] transition-colors">
                        {/* Step number cell */}
                        <td className="px-4 py-3 border-b border-[hsl(var(--rule-warm)/0.45)] align-top text-center font-display font-black text-tomato">
                          {rowIndex + 1}
                        </td>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="px-4 py-3 border-b border-[hsl(var(--rule-warm)/0.45)] text-sm align-top"
                          >
                            {cell.url ? (
                              <a
                                href={cell.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-tomato no-underline hover:underline"
                              >
                                {cell.value}
                              </a>
                            ) : (
                              cell.value
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground">
                <div aria-hidden className="text-5xl mb-4 opacity-50">
                  {contentError?.includes('private') ? '🔒' :
                   contentError?.includes('not found') ? '🔍' :
                   contentError?.includes('No Google Sheet link') ? '📋' : '⚠️'}
                </div>
                <p className="font-display text-lg font-black text-foreground mb-2 mt-0">
                  {contentError?.includes('private') ? 'Private Sheet' :
                   contentError?.includes('not found') ? 'Sheet Not Found' :
                   contentError?.includes('No Google Sheet link') ? 'No Sheet Link' :
                   'Unable to Load Content'}
                </p>
                <p className="text-sm max-w-[400px] mx-auto mb-5 mt-0" style={{ textWrap: "pretty" }}>
                  {contentError || "The sheet content could not be loaded."}
                </p>
                {manual.url && (
                  <a href={manual.url} target="_blank" rel="noopener noreferrer" className={pillInk}>
                    Open in Google Sheets
                  </a>
                )}
                {!manual.url && manual.status?.toLowerCase() === 'needed' && (
                  <p className="text-[13px] text-muted-foreground mt-3">
                    This manual needs to be written. Check with the crew lead.
                  </p>
                )}
              </div>
            )}
          </div>
        </article>
      )}
    </EditorialPage>
  );
}
