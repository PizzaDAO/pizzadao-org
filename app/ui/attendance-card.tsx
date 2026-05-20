"use client";

import { useEffect, useState } from "react";
import type { AttendanceResult } from "@/app/lib/attendance";

/**
 * Per-member call attendance summary card.
 *
 * Phase 3c restyle: replaced `--color-*` back-compat CSS variables with
 * semantic Tailwind classes and HSL tokens so the card matches the
 * pizzadao.org cream-warm rhythm. Tomato accent on the headline number
 * gives the same "loud key stat" treatment used on the marketing site.
 *
 * Layout-leak fix (truffle-91035 PR1): the card used to own its own
 * `mt-6 pt-6 border-t border-rule` wrapper, which made it always render
 * glued to a top-border regardless of where it was placed. The `variant`
 * prop now decouples that. `"standalone"` (default) preserves the
 * original wrapper — keeping all current call sites visually identical to
 * main. `"inline"` drops the wrapper so a parent section can own the
 * spacing/border, which the profile redesign needs.
 */
interface AttendanceCardProps {
  memberId: string;
  /**
   * Visual variant.
   * - `"standalone"` (default): renders inside a `mt-6 pt-6 border-t border-rule`
   *   wrapper, identical to the pre-refactor behavior.
   * - `"inline"`: renders without the outer spacing/border wrapper. Use when the
   *   parent owns the section chrome (e.g. inside a `CollapsibleSection`).
   */
  variant?: "standalone" | "inline";
}

export function AttendanceCard({ memberId, variant = "standalone" }: AttendanceCardProps) {
  const [data, setData] = useState<AttendanceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAttendance() {
      try {
        const res = await fetch(`/api/attendance/${memberId}`);
        if (res.ok) {
          const json: AttendanceResult = await res.json();
          setData(json);
        }
      } catch {
        // silently fail — attendance is supplementary info
      } finally {
        setLoading(false);
      }
    }
    if (memberId) {
      fetchAttendance();
    }
  }, [memberId]);

  // Don't render anything if loading, error, or zero calls
  if (loading || !data || data.totalCalls === 0) {
    return null;
  }

  const crewEntries = Object.entries(data.crewBreakdown)
    .map(([key, value]) => {
      // Handle both formats: flat number (from rebuild script) or { crewLabel, count }
      if (typeof value === "number") {
        return [key, { crewLabel: key, count: value }] as const;
      }
      return [key, value as { crewLabel: string; count: number }] as const;
    })
    .sort((a, b) => b[1].count - a[1].count);

  const body = (
    <>
      <h3 className="mt-0 mb-4 font-display text-lg font-semibold text-foreground">
        Call Attendance
      </h3>

      {/* Total calls — big number, tomato accent */}
      <div
        className="text-center mb-5 p-4 rounded-[--radius] border border-rule"
        style={{ background: "hsl(var(--background))" }}
      >
        <div
          className="font-display font-bold leading-none"
          style={{ fontSize: "2.5rem", color: "hsl(var(--tomato))" }}
        >
          {data.totalCalls}
        </div>
        <div className="mt-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Total Calls Attended
        </div>
      </div>

      {/* Per-crew breakdown */}
      {crewEntries.length > 0 && (
        <div
          className="grid gap-2 mb-5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
        >
          {crewEntries.map(([crewId, info]) => (
            <div
              key={crewId}
              className="p-3 rounded-[--radius] border border-rule text-center"
              style={{ background: "hsl(var(--background))" }}
            >
              <div className="font-display font-bold text-2xl text-foreground">
                {info.count}
              </div>
              <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                {info.crewLabel}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent calls list */}
      {data.recentCalls.length > 0 && (
        <div>
          <h4 className="m-0 mb-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
            Recent Calls
          </h4>
          <div className="grid gap-1">
            {data.recentCalls.map((call, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center px-2.5 py-1.5 rounded-md text-sm"
                style={{
                  background:
                    idx % 2 === 0 ? "transparent" : "hsl(var(--background))",
                }}
              >
                <span className="font-medium text-foreground">{call.crew}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(call.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  if (variant === "inline") {
    return body;
  }

  return <div className="mt-6 pt-6 border-t border-rule">{body}</div>;
}
