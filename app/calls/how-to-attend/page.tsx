// How to attend a crew call: schedule, joining the Discord voice channel,
// what happens on a call, and (signed in) the member's next mission.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { DAYS_OF_WEEK, parseCallTime } from "@/app/lib/crew-schedule";
import { getMissionsOverview } from "@/app/lib/missions-overview";
import { pickNextMission, type NextMission } from "@/app/lib/next-mission";
import { EditorialMasthead, EditorialPage, paperCard, pillInk, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("howToAttend");
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: { canonical: "/calls/how-to-attend" } };
}

export default async function HowToAttendPage() {
  const t = await getTranslations("howToAttend");
  const session = await getSession();

  let crews: { id: string; label: string; callTime?: string }[] = [];
  try { crews = (await getCrewMappings()).crews; } catch { /* schedule is optional */ }
  const scheduled = crews
    .filter((c) => c.callTime && parseCallTime(c.callTime))
    .sort((a, b) => {
      const pa = parseCallTime(a.callTime)!, pb = parseCallTime(b.callTime)!;
      const d = (DAYS_OF_WEEK as readonly string[]).indexOf(pa.day) - (DAYS_OF_WEEK as readonly string[]).indexOf(pb.day);
      return d || pa.sortableTime - pb.sortableTime;
    });

  let next: NextMission | null = null;
  if (session?.discordId) {
    try { next = pickNextMission(await getMissionsOverview(session.discordId)); } catch { /* CTA falls back to /missions */ }
  }
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const discordHref = guildId ? `https://discord.com/channels/${guildId}` : "https://discord.com/app";

  const steps = ["find", "discord", "voice", "stay"] as const;

  return (
    <EditorialPage width="max-w-3xl">
      <EditorialMasthead
        overline={t("overline")}
        title={<>{t("titlePrefix")} <span className="text-tomato-readable underline-scribble">{t("titleAccent")}</span></>}
        dek={t("dek")}
      >
        <nav className="flex flex-wrap gap-2.5" aria-label={t("pages")}>
          <Link href="/crews" className={pillOutline}>{t("crews")}</Link>
          <Link href="/calls" className={pillOutline}>{t("callLog")}</Link>
        </nav>
      </EditorialMasthead>

      <ol className="grid gap-4 list-none p-0 m-0 mb-8">
        {steps.map((s, i) => (
          <li key={s} className={`${paperCard} p-4 sm:p-5`}>
            <p className="overline text-tomato m-0">{t("step", { n: i + 1 })}</p>
            <h2 className="font-display text-xl font-black mt-1 mb-1">{t(`steps.${s}.title`)}</h2>
            <p className="m-0 text-foreground/80">{t(`steps.${s}.body`)}</p>
            {s === "discord" && <a href={discordHref} target="_blank" rel="noopener noreferrer" className={`${pillInk} mt-3`}>{t("openDiscord")}</a>}
          </li>
        ))}
      </ol>

      {scheduled.length > 0 && (
        <section className={`${paperCard} p-4 sm:p-5 mb-8`} aria-label={t("scheduleTitle")}>
          <h2 className="font-display text-xl font-black mt-0 mb-3">{t("scheduleTitle")}</h2>
          <ul className="grid gap-1 list-none p-0 m-0">
            {scheduled.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2">
                <Link href={`/crew/${c.id}`} className="font-semibold">{c.label}</Link>
                <span className="text-foreground/70">{c.callTime}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${paperCard} p-4 sm:p-5 mb-8`} aria-label={t("recordedTitle")}>
        <h2 className="font-display text-xl font-black mt-0 mb-1">{t("recordedTitle")}</h2>
        <p className="m-0 text-foreground/80">{t("recordedBody")}</p>
      </section>

      <section className={`${paperCard} p-4 sm:p-5 mb-8`} aria-label={t("sliceTitle")}>
        <h2 className="font-display text-xl font-black mt-0 mb-1">{t("sliceTitle")}</h2>
        <p className="mt-0 mb-3 text-foreground/80">{t("sliceBody")}</p>
        <Link href="/slices" className={pillOutline}>{t("sliceCta")}</Link>
      </section>

      <section className="ink-bottom rounded-[var(--radius)] bg-foreground text-background p-5 sm:p-6" aria-label={t("nextTitle")}>
        <p className="overline m-0">{t("nextTitle")}</p>
        {!session ? (
          <>
            <p className="my-2">{t("nextAnon")}</p>
            <Link href="/login?returnTo=/calls/how-to-attend" className={pillTomato}>{t("login")}</Link>
          </>
        ) : next ? (
          <>
            <p className="font-display text-xl font-black my-2">{next.title}</p>
            <p className="mt-0 mb-3 opacity-80">{t("nextLevel", { level: next.level })}</p>
            <Link href="/missions" className={pillTomato}>{t("nextCta")}</Link>
          </>
        ) : (
          <>
            <p className="my-2">{t("nextNone")}</p>
            <Link href="/missions" className={pillTomato}>{t("nextCtaAll")}</Link>
          </>
        )}
      </section>
    </EditorialPage>
  );
}
