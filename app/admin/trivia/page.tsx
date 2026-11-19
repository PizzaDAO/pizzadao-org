// app/admin/trivia/page.tsx
//
// Trivia admin, READ ONLY in phase 1 (plans/trivia.md §4.2, §12): bank stats and what is held back, recent rounds and
// the "report a problem" queue. No writes: disabling a question is a bank edit (PR) until phase 2 adds the setting.
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
import { bankStats, getQuestion } from "@/app/lib/trivia/bank";
import { getDisabledIds, openReportGroups } from "@/app/lib/trivia/reports";
import { ReportActions } from "./ReportActions";
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

async function loadRuntime() {
  try {
    const [rounds, reports, openReports, groups, disabledIds] = await Promise.all([
      prisma.triviaRound.findMany({ orderBy: { id: "desc" }, take: 25 }),
      prisma.triviaReport.findMany({ orderBy: { id: "desc" }, take: 50 }),
      prisma.triviaReport.count({ where: { status: "open" } }),
      openReportGroups(),
      getDisabledIds(),
    ]);
    return { available: true as const, rounds, reports, openReports, groups, disabledIds };
  } catch (e) {
    console.error("[trivia] admin runtime data unavailable:", (e as Error).message);
    return { available: false as const, rounds: [], reports: [], openReports: 0, groups: [], disabledIds: [] as string[] };
  }
}

export default async function AdminTriviaPage() {
  const session = await getSession();
  if (!session?.discordId) redirect(loginHrefFrom("/admin/trivia"));
  if (!(await isAdminDiscordId(session.discordId))) notFound();

  const t = await getTranslations("trivia");
  const stats = bankStats();
  const data = await loadRuntime();

  return (
    <EditorialPage>
      <EditorialMasthead overline="Admin" title={t("adminTitle")} dek="The bank is data/trivia/questions.json: change it with a PR. Reported questions can be disabled here (they are pulled from Discord and the web at once)." />

      <div className="grid gap-6">
        <section className={`${paperCard} p-6`}>
          <SectionHeading overline="Bank" title="Questions" count={stats.total} />
          <div className="grid gap-3 text-sm">
            <p className="m-0">
              Served on the web: <strong>{stats.servableWeb}</strong> · Reserved for Discord (never on the web): <strong>{stats.servableDiscord}</strong>
            </p>
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
                const q = getQuestion(g.questionId);
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
