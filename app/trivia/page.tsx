import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import DailyCard from "./_components/DailyCard";
import PracticeCard from "./_components/PracticeCard";
import LeaderboardCard from "./_components/LeaderboardCard";
import SuggestCard from "./_components/SuggestCard";

// Static shell: the question, answers and leaderboard are all fetched by the cards from /api/trivia/*, which never
// sends an answer before an attempt. Works logged out.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trivia");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function TriviaPage() {
  const t = await getTranslations("trivia");
  return (
    <EditorialPage width="max-w-3xl">
      <EditorialMasthead overline={t("overline")} title={t("title")} dek={t("dek")} />
      <div className="grid gap-6">
        <DailyCard />
        <PracticeCard />
        <LeaderboardCard />
        <SuggestCard />
        <section className={`${paperCard} p-6 sm:p-8`} aria-labelledby="trivia-how-title">
          <p className="overline m-0 text-tomato-readable">{t("howOverline")}</p>
          <h2 id="trivia-how-title" className="font-display mb-0 mt-1 text-xl font-black md:text-2xl">
            {t("howTitle")}
          </h2>
          <p className="mb-0 mt-3 rounded-[var(--radius)] bg-[hsl(var(--butter)/0.3)] px-3 py-2 text-sm font-semibold text-foreground">{t("howSoon")}</p>
          <ol className="mb-0 mt-4 list-decimal space-y-2 pl-5 text-foreground/80" style={{ lineHeight: 1.55 }}>
            <li>{t("how1")}</li>
            <li>{t("how2")}</li>
            <li>{t("how3")}</li>
            <li>{t("how4")}</li>
            <li>{t("how5")}</li>
          </ol>
        </section>
      </div>
    </EditorialPage>
  );
}
