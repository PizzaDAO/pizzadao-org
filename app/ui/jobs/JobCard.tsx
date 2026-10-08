"use client";

// Clicking (or Enter / Space on) anywhere on the card completes the job —
// except for a real link inside the description (a channel mention or a
// markdown/bare-url link), which should open that link instead. Those two
// click targets can't both be the same <button> (an <a> can't nest inside
// a <button>), so this uses the "stretched button" pattern: the button is
// an absolutely-positioned, invisible overlay covering the whole card
// (`inset-0`, catching clicks everywhere); the visible content sits above
// it in a `pointer-events: none` layer so clicks pass through to the
// button, except the description's real anchors opt back into
// `pointer-events: auto` (set by DiscordText itself) so a tap on a link
// is captured by the link, not the button underneath it.
//
// Disabled once done, while the request runs, or when the board disables
// it. The reward is a plain "50 $PEP".

import React, { useState } from "react";
import { formatPep } from "../economy/PepIcon";
import { paperCard } from "../shared/Editorial";
import { DiscordText } from "../shared/DiscordText";
import { parseDiscordMarkup, discordMarkupToPlainText } from "@/app/lib/discord-markup";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
};

type JobCardProps = {
  job: Job;
  rewardAmount: number;
  alreadyCompleted?: boolean;
  onAssign?: () => void;
  disabled?: boolean;
  /** channel/role id -> name maps resolved server-side, and the guild id for channel links */
  channels?: Record<string, string>;
  roles?: Record<string, string>;
  guildId?: string | null;
};

const chip =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold";

export function JobCard({
  job,
  rewardAmount,
  alreadyCompleted,
  onAssign,
  disabled,
  channels,
  roles,
  guildId,
}: JobCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [earnedReward, setEarnedReward] = useState<number | null>(null);

  const completed = alreadyCompleted || justCompleted;
  const inactive = completed || loading || !!disabled;
  const errorId = `job-${job.id}-error`;

  const handleAssign = async () => {
    if (inactive) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setJustCompleted(true);
      setEarnedReward(data.reward);

      // Refresh after a short delay to update balance display
      setTimeout(() => {
        onAssign?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete job");
    } finally {
      setLoading(false);
    }
  };

  const reward = earnedReward || rewardAmount;

  const plainDescription = discordMarkupToPlainText(
    parseDiscordMarkup(job.description, { channels, roles }),
  );
  const actionWord = completed ? "Paid" : loading ? "Working on" : "Complete";

  return (
    <div>
      <div
        data-testid="job-card"
        className={[
          "group relative flex w-full items-center gap-4 p-4 text-left",
          paperCard,
          "shadow-[var(--shadow-soft)] transition-[transform,border-color,box-shadow] duration-200",
          completed
            ? "border-[hsl(142_71%_35%/0.35)] bg-[hsl(142_71%_35%/0.06)]"
            : inactive
              ? "opacity-60"
              : "hover:-translate-y-0.5 hover:border-[hsl(var(--tomato)/0.55)] hover:shadow-[var(--shadow-lifted)]",
        ].join(" ")}
      >
        {/* Stretched hit target: covers the whole card, carries the
            accessible name/state, and is the sole focusable control. */}
        <button
          type="button"
          onClick={handleAssign}
          disabled={inactive}
          aria-busy={loading || undefined}
          aria-describedby={error ? errorId : undefined}
          aria-label={`${actionWord} job: ${plainDescription} — ${formatPep(reward)}`}
          // `.paper-soft > * { position: relative; z-index: 1 }` in globals.css now lives in
          // `@layer components`, so these `absolute`/`inset-0`/`z-0` utilities (in Tailwind's
          // `utilities` layer) win by layer order — no inline style override needed any more.
          // (Previously this was unlayered and beat the utilities, putting the button back in
          // the flex row and crushing the description column — see PR #158.)
          className={[
            "absolute inset-0 z-0 h-full w-full rounded-[inherit] border-0 bg-transparent p-0",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            completed ? "cursor-default" : inactive ? "cursor-not-allowed" : "cursor-pointer active:translate-y-0",
          ].join(" ")}
        />

        <span className="relative z-10 min-w-0 flex-1" style={{ pointerEvents: "none" }}>
          <span className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={`${chip} border-[hsl(var(--rule)/0.22)] bg-muted text-foreground`}>
              {job.type || "General"}
            </span>
            {completed && (
              <span className={`${chip} border-[hsl(142_71%_35%/0.35)] bg-[hsl(142_71%_35%/0.12)] text-[hsl(142_71%_30%)]`}>
                Done
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">#{job.id}</span>
          </span>
          <span className="block text-sm leading-[1.45] text-foreground">
            <DiscordText text={job.description} channels={channels} roles={roles} guildId={guildId} />
          </span>
        </span>

        <span className="relative z-10 flex shrink-0 flex-col items-end gap-1 text-right" style={{ pointerEvents: "none" }}>
          <span
            className={`font-[family-name:var(--font-display)] text-lg font-black tracking-tight tabular-nums whitespace-nowrap ${
              completed ? "text-[hsl(142_71%_30%)]" : "text-tomato"
            }`}
          >
            {completed && earnedReward ? "+" : ""}
            {formatPep(reward)}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/55">
            {loading ? "Working…" : completed ? "Paid" : "Complete"}
            {!completed && !loading && (
              <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            )}
          </span>
        </span>
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 mb-0 rounded-[var(--radius)] border border-[hsl(var(--tomato)/0.30)] bg-[hsl(var(--tomato)/0.06)] p-2 text-xs text-tomato"
        >
          {error}
        </p>
      )}
    </div>
  );
}
