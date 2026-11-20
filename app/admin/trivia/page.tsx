// app/admin/trivia/page.tsx
//
// Trivia admin (plans/trivia.md §4.2, §12): bank stats, the question bank editor (the bank is in the database, never in
// the public repo), reported questions (disable = trivia.disabledQuestionIds), community suggestions ("Add to bank"),
// recent rounds. Every write goes through /api/admin/trivia(/questions), which checks the admin again.
// Gate: ADMIN_ROLE_IDS (isAdminDiscordId, fails closed). A visitor with no session gets a real 307 to log in from proxy.ts
// before anything renders. A signed-in non-admin gets notFound(): the site's not-found page, but with a 200 status (the root
// layout's Suspense has already sent the status by the time the page runs), and no admin data is rendered or sent.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { loginHrefFrom } from "@/app/lib/login-return";
import { bankStats, getBank } from "@/app/lib/trivia/bank";
import { listAdminQuestions, type AdminQuestionRow } from "@/app/lib/trivia/bank-admin";
import { nextQuestionId } from "@/app/lib/trivia/suggestion-core";
import { CATEGORIES } from "@/app/lib/trivia/schema";
import { getDisabledIds, openReportGroups } from "@/app/lib/trivia/reports";
import { openSuggestions } from "@/app/lib/trivia/suggestions";
import { ReportActions } from "./ReportActions";
import { SuggestionActions } from "./SuggestionActions";
import { BankEditor, type LiveIds } from "./BankEditor";
import { dayKeyUtc } from "@/app/lib/trivia/daily";
import { EditorialMasthead, EditorialPage, SectionHeading, paperCard } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Trivia",
  robots: { index: false, follow: false },
};

function Counts({ data }: { data: Record<string, number> }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
      {Object.entries(data)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => (
          <li key={k}>
            <span className="text-foreground/70">{k}</span> <strong className="tabular-nums">{v}</strong>
          </li>
        ))}
    </ul>
  );
}

async function loadBankRows(): Promise<AdminQuestionRow[] | null> {
  try {
    return await listAdminQuestions();
  } catch (e) {
    console.error("[trivia] admin bank rows unavailable:", (e as Error).message);
    return null;
  }
}

/** Today's web daily and the open Discord round's question, so the editor can warn before changing them. */
async function loadLive(): Promise<LiveIds> {
  try {
    const [daily, open] = await Promise.all([
      prisma.triviaRound.findUnique({ where: { dayKey: dayKeyUtc() }, select: { questionId: true } }),
      prisma.triviaRound.findFirst({ where: { surface: "DISCORD", status: "OPEN" }, orderBy: { id: "desc" }, select: { questionId: true } }),
    ]);
    return { daily: daily?.questionId ?? null, discord: open?.questionId ?? null };
  } catch {
    return { daily: null, discord: null };
  }
}

async function loadRuntime() {
  try {
    const [rounds, reports, openReports, groups, disabledIds, suggestions] = await Promise.all([
      prisma.triviaRound.findMany({ orderBy: { id: "desc" }, take: 25 }),
      prisma.triviaReport.findMany({ where: { kind: "report" }, orderBy: { id: "desc" }, take: 50 }),
      prisma.triviaReport.count({ where: { kind: "report", status: "open" } }),
      openReportGroups(),
      getDisabledIds(),
      openSuggestions(),
    ]);
    return { available: true as const, rounds, reports, openReports, groups, disabledIds, suggestions };
  } catch (e) {
    console.error("[trivia] admin runtime data unavailable:", (e as Error).message);
    return { available: false as const, rounds: [], reports: [], openReports: 0, groups: [], disabledIds: [] as string[], suggestions: [] as Awaited<ReturnType<typeof openSuggestions>> };
  }
}

export default async function AdminTriviaPage() {
  const session = await getSession();
  if (!session?.discordId) redirect(loginHrefFrom("/admin/trivia"));
  if (!(await isAdminDiscordId(session.discordId))) notFound();

  const t = await getTranslations("trivia");
  const [stats, bank, rows, data, live] = await Promise.all([bankStats(), getBank(), loadBankRows(), loadRuntime(), loadLive()]);
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const allIds = (rows ?? []).map((r) => r.id);
  const nextIds = Object.fromEntries(CATEGORIES.map((c) => [c, nextQuestionId(c, allIds)]));

  return (
    <EditorialPage>
      <EditorialMasthead overline="Admin" title={t("adminTitle")} dek="The question bank lives in the database (never in the public repo): edit it below. Reported questions can be disabled here (they are pulled from Discord and the web at once)." />

      <div className="grid gap-6">
        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Bank" title="Questions" count={stats.total} />
          <div className="grid gap-3 text-sm">
            <p className="m-0">
              Served on the web: <strong>{stats.servableWeb}</strong> · Reserved for Discord (never on the web): <strong>{stats.servableDiscord}</strong> · Approved and exposed (want rewording):{" "}
              <strong>{stats.exposedApproved}</strong>
            </p>
            {!stats.available && <p className="m-0 text-tomato">The question bank could not be read: Discord rounds and the web daily are skipped until it can.</p>}
            {stats.available && stats.total === 0 && (
              <p className="m-0 text-tomato">The question bank is empty: import it (scripts/trivia/import-bank.ts) or add questions below. Discord rounds and the web daily are skipped until then.</p>
            )}
            {stats.invalid.length > 0 && <p className="m-0 text-tomato">Rows that fail the schema (not served): {stats.invalid.map((i) => i.id).join(", ")}</p>}
            <div>
              <p className="overline m-0 text-foreground/70">Status</p>
              <Counts data={stats.byStatus} />
            </div>
            <div>
              <p className="overline m-0 text-foreground/70">Approved by category</p>
              <Counts data={stats.byCategory} />
            </div>
            <div>
              <p className="overline m-0 text-foreground/70">Approved by type</p>
              <Counts data={stats.byType} />
            </div>
            <div>
              <p className="overline m-0 text-foreground/70">Approved by difficulty</p>
              <Counts data={stats.byDifficulty} />
            </div>
            <div>
              <p className="overline m-0 text-foreground/70">Held back (never served)</p>
              <p className="m-0">{stats.notServed.map((q) => `${q.id} (${q.status})`).join(", ") || "none"}</p>
            </div>
            <div>
              <p className="overline m-0 text-foreground/70">Retires (validUntil)</p>
              <p className="m-0">{stats.expiring.map((q) => `${q.id}: ${q.validUntil}`).join(", ") || "none"}</p>
            </div>
          </div>
        </section>

        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Bank" title="Question editor" count={rows?.length ?? 0} />
          {rows ? (
            <BankEditor initialRows={rows} nextIds={nextIds} live={live} />
          ) : (
            <p className="m-0 text-sm" role="status">
              The question bank table could not be read (the migration may not be applied to this database yet).
            </p>
          )}
        </section>

        {!data.available && (
          <p className={`${paperCard} m-0 p-4 text-sm`} role="status">
            The Trivia tables could not be read (the migration may not be applied to this database yet). Rounds and reports are unavailable.
          </p>
        )}

        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Reports" title="Reported questions" count={data.groups.length} />
          <p className="mt-0 text-sm text-foreground/70">
            Open reports grouped by question, newest first. Disabling pulls the question from Discord and the web at once (it is the pulled-questions setting; 3 different members reporting within 7 days does the same automatically).
          </p>
          {data.groups.length === 0 ? (
            <p className="m-0 text-sm text-foreground/70">No open reports.</p>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {data.groups.map((g) => {
                const q = byId.get(g.questionId);
                const disabled = data.disabledIds.includes(g.questionId);
                return (
                  <li key={g.questionId} className="grid gap-2 border-b border-[hsl(var(--rule-warm)/0.3)] pb-4 text-sm">
                    <p className="m-0">
                      <span className="font-mono">{g.questionId}</span> · <strong className="tabular-nums">{g.count}</strong> report{g.count === 1 ? "" : "s"} from{" "}
                      <strong className="tabular-nums">{g.members}</strong> member{g.members === 1 ? "" : "s"} · latest {g.latestAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      {disabled && <strong className="ml-2 text-tomato">disabled</strong>}
                    </p>
                    {q && <p className="m-0 text-foreground/80">{q.question}</p>}
                    <ul className="m-0 list-disc pl-5 text-foreground/70">
                      {g.texts.map((t, i) => (
                        <li key={i}>{t.text}</li>
                      ))}
                    </ul>
                    <ReportActions questionId={g.questionId} disabled={disabled} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${paperCard} p-6`}>
          <SectionHeading overline={t("adminSuggestionsOverline")} title={t("adminSuggestionsTitle")} count={data.suggestions.length} />
          <p className="mt-0 text-sm text-foreground/70">{t("adminSuggestionsHelp")}</p>
          {data.suggestions.length === 0 ? (
            <p className="m-0 text-sm text-foreground/70">{t("adminSuggestionsEmpty")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {data.suggestions.map((s) => (
                <li key={s.id} className="grid gap-2 border-b border-[hsl(var(--rule-warm)/0.3)] pb-4 text-sm">
                  <p className="m-0 text-foreground/70">
                    #{s.id} · {s.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </p>
                  {s.suggestion ? (
                    <>
                      <p className="m-0 font-semibold">{s.suggestion.question}</p>
                      <p className="m-0">
                        {t("adminAnswer")}: <strong>{s.suggestion.answer}</strong>
                        {s.suggestion.aliases.length > 0 && <span className="text-foreground/70"> ({s.suggestion.aliases.join(", ")})</span>}
                        {s.suggestion.category && <span className="text-foreground/70"> · {s.suggestion.category}</span>}
                      </p>
                      <p className="m-0 break-all">
                        <a href={s.suggestion.source} target="_blank" rel="noopener noreferrer" className="text-tomato-readable underline underline-offset-2">
                          {s.suggestion.source}
                        </a>
                      </p>
                    </>
                  ) : (
                    <p className="m-0 text-tomato">{t("adminSuggestionUnreadable")}</p>
                  )}
                  {s.snippet && <pre className="m-0 max-h-48 overflow-auto rounded-xl bg-[hsl(var(--butter)/0.2)] p-3 text-xs">{s.snippet}</pre>}
                  <SuggestionActions
                    suggestionId={s.id}
                    canAdd={!!s.snippet}
                    labels={{
                      addToBank: t("adminAddToBank"),
                      addedToBank: t("adminAddedToBank", { id: "{id}" }),
                      dismiss: t("adminDismiss"),
                      failed: t("adminSaveFailed"),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Reports" title="All reports" count={data.openReports} />
          {data.reports.length === 0 ? (
            <p className="m-0 text-sm text-foreground/70">No reports.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--rule-warm)/0.55)] text-foreground/70">
                    <th className="py-2 pr-3 font-semibold">When (UTC)</th>
                    <th className="py-2 pr-3 font-semibold">Question</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 font-semibold">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.map((r) => (
                    <tr key={r.id} className="border-b border-[hsl(var(--rule-warm)/0.3)] align-top">
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td className="py-2 pr-3 font-mono">{r.questionId}</td>
                      <td className="py-2 pr-3">{r.status}</td>
                      <td className="py-2">{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Rounds" title="Recent rounds" count={data.rounds.length} />
          {data.rounds.length === 0 ? (
            <p className="m-0 text-sm text-foreground/70">No rounds yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--rule-warm)/0.55)] text-foreground/70">
                    <th className="py-2 pr-3 font-semibold">#</th>
                    <th className="py-2 pr-3 font-semibold">Surface</th>
                    <th className="py-2 pr-3 font-semibold">Question</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Day</th>
                    <th className="py-2 font-semibold">Opened (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rounds.map((r) => (
                    <tr key={r.id} className="border-b border-[hsl(var(--rule-warm)/0.3)]">
                      <td className="py-2 pr-3 tabular-nums">{r.id}</td>
                      <td className="py-2 pr-3">{r.surface}</td>
                      <td className="py-2 pr-3 font-mono">{r.questionId}</td>
                      <td className="py-2 pr-3">{r.status}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.dayKey ?? ""}</td>
                      <td className="whitespace-nowrap py-2 tabular-nums">{r.openedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </EditorialPage>
  );
}
