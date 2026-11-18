"use client";

// Leaderboard shell: Discord wins (all-time / this month) and daily streaks. Top 25, names only (never Discord ids).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, FilterChip, paperCard } from "@/app/ui/shared/Editorial";

interface Entry {
  rank: number;
  name: string;
  memberId: string | null;
  score: number;
  capped?: boolean;
}
interface BoardDto {
  available: boolean;
  wins: { allTime: Entry[]; month: Entry[] };
  streaks: Entry[];
}

type Tab = "winsAll" | "winsMonth" | "streaks";

export default function LeaderboardCard() {
  const t = useTranslations("trivia");
  const [board, setBoard] = useState<BoardDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("streaks");

  useEffect(() => {
    let live = true;
    fetch("/api/trivia/leaderboard")
      .then((r) => (r.ok ? (r.json() as Promise<BoardDto>) : Promise.reject(new Error(String(r.status)))))
      .then((b) => live && setBoard(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const rows = !board ? [] : tab === "winsAll" ? board.wins.allTime : tab === "winsMonth" ? board.wins.month : board.streaks;
  const scoreHeading = tab === "streaks" ? t("colDays") : t("colWins");

  return (
    <section className={`${paperCard} p-6 sm:p-8`} aria-labelledby="trivia-board-title">
      <p className="overline m-0 text-tomato-readable">{t("leaderboardOverline")}</p>
      <h2 id="trivia-board-title" className="font-display mb-0 mt-1 text-xl font-black md:text-2xl">
        {t("leaderboardTitle")}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("leaderboardTitle")}>
        <FilterChip label={t("tabStreaks")} active={tab === "streaks"} onClick={() => setTab("streaks")} />
        <FilterChip label={t("tabWinsMonth")} active={tab === "winsMonth"} onClick={() => setTab("winsMonth")} />
        <FilterChip label={t("tabWinsAll")} active={tab === "winsAll"} onClick={() => setTab("winsAll")} />
      </div>

      <div className="mt-5">
        {failed && (
          <p role="alert" className="m-0 text-tomato-readable">
            {t("loadError")}
          </p>
        )}
        {!failed && !board && <p className="m-0 text-foreground/70">{t("loading")}</p>}
        {board && !board.available && <p className="m-0 text-foreground/70">{t("leaderboardUnavailable")}</p>}
        {board && board.available && rows.length === 0 && <EmptyState title={t("leaderboardEmpty")}>{t("leaderboardEmptyHint")}</EmptyState>}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--rule-warm)/0.55)] text-foreground/70">
                <th className="w-16 py-2 pr-2 font-semibold">{t("colRank")}</th>
                <th className="py-2 pr-2 font-semibold">{t("colName")}</th>
                <th className="w-20 py-2 text-right font-semibold">{scoreHeading}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.rank}-${r.name}`} className="border-b border-[hsl(var(--rule-warm)/0.3)]">
                  <td className="py-2 pr-2 tabular-nums">{r.rank}</td>
                  <td className="py-2 pr-2">
                    {r.memberId ? (
                      <Link href={`/profile/${encodeURIComponent(r.memberId)}`} className="text-foreground underline underline-offset-2">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">{r.score}{r.capped ? "+" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
