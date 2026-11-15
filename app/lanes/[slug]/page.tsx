// Lane guide (plans/lane-cards-mission-onboarding.md): the lane's mission and a step-by-step checklist.
// Not found while the lane cards setting is off or the lane is unpublished. Members only: visitors
// are sent to sign up / log in and come back here.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { getHandbookFacts, renderPlaceholders } from "@/app/lib/handbook";
import { resolveLocale } from "@/app/lib/i18n/get-locale";
import { getMemberLane, getPublishedLane, lanesEnabled } from "@/app/lib/lanes";
import { isLaneSlug } from "@/app/lib/lanes/links";
import { computeProgress, pickPinned } from "@/app/lib/lanes/progress";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { HandbookMarkdown } from "@/app/ui/handbook/HandbookMarkdown";
import { EditorialMasthead, EditorialPage, paperCard, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";
import { LaneStepItem, PinButton, PinOnArrive } from "@/app/ui/lanes/LaneClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ pick?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const lane = (await lanesEnabled()) ? await getPublishedLane(slug).catch(() => null) : null;
    return { title: lane ? lane.title : "Lane", robots: { index: false, follow: false } };
}

export default async function LanePage({ params, searchParams }: Props) {
    const { slug } = await params;
    const { pick } = await searchParams;
    if (!isLaneSlug(slug) || !(await lanesEnabled())) notFound();
    const lane = await getPublishedLane(slug).catch(() => null);
    if (!lane) notFound();

    const pickPath = `/lanes/${slug}?pick=1`;
    const session = await getSession();
    if (!session?.discordId) redirect(`/join?returnTo=${encodeURIComponent(pickPath)}`);
    const memberId = await fetchMemberIdByDiscordId(session.discordId).catch(() => null);
    if (!memberId) redirect(`/join?returnTo=${encodeURIComponent(pickPath)}`);

    const t = await getTranslations("lanes");
    const locale = await resolveLocale();
    const discordId = session.discordId;
    const wantsPin = pick === "1";

    const [facts, row, myRows, mission, completion, stretch] = await Promise.all([
        getHandbookFacts(locale),
        getMemberLane(discordId, slug),
        prisma.memberLane.findMany({ where: { discordId, pinnedAt: { not: null } }, orderBy: { pinnedAt: "desc" }, take: 10 }),
        lane.missionId != null ? prisma.mission.findUnique({ where: { id: lane.missionId }, select: { id: true, title: true, description: true, isActive: true } }) : null,
        lane.missionId != null
            ? prisma.missionCompletion.findUnique({ where: { missionId_discordId: { missionId: lane.missionId, discordId } }, select: { status: true } })
            : null,
        lane.stretchMissionIds.length ? prisma.mission.findMany({ where: { id: { in: lane.stretchMissionIds }, isActive: true }, select: { id: true, title: true } }) : [],
    ]);

    const pinnedSlug = pickPinned(myRows)?.laneSlug ?? null;
    const isPinned = pinnedSlug === slug || wantsPin; // the pin is written on arrival when coming from a card
    const submitDone = completion?.status === "PENDING" || completion?.status === "APPROVED";
    const progress = computeProgress(lane.steps, row?.doneStepIds ?? [], submitDone);
    const missionHref = mission ? `/missions#mission-${mission.id}` : null;
    const statusLabel = !completion
        ? t("missionOpen")
        : completion.status === "APPROVED"
            ? t("missionApproved")
            : completion.status === "PENDING"
                ? t("missionPending")
                : t("missionRejected");
    const index = Math.max(1, lane.position);

    return (
        <EditorialPage width="max-w-3xl">
            <PinOnArrive slug={slug} pick={wantsPin} />
            <EditorialMasthead overline={`${t("overline", { n: String(index).padStart(2, "0") })} · ${lane.tag}`} title={lane.title} dek={lane.summary}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Link href="/community#ways-in" className={pillOutline}>{`← ${t("allLanes")}`}</Link>
                    {isPinned ? (
                        <span className="rounded-full border border-[hsl(var(--foreground)/0.25)] px-3 py-1 text-sm font-bold">{t("pinned")}</span>
                    ) : (
                        <PinButton slug={slug} label={t("pin")} busyLabel={t("pinning")} errorLabel={t("saveError")} />
                    )}
                    <span className="text-sm text-foreground/70">{t("progress", { done: progress.done, total: progress.total })}</span>
                </div>
            </EditorialMasthead>

            {mission && (
                <section className={`${paperCard} mb-6 grid gap-2 p-5`} aria-label={t("missionHeading")}>
                    <p className="overline m-0">{t("missionHeading")}</p>
                    <h2 className="font-display m-0 text-xl font-black">{mission.title}</h2>
                    {mission.description && <p className="m-0 text-foreground/80">{mission.description}</p>}
                    {mission.isActive ? (
                        <p className="m-0 flex flex-wrap items-center gap-3">
                            <span className="text-sm font-bold">{statusLabel}</span>
                            <Link href={missionHref as string} className={pillTomato}>{t("missionSubmit")}</Link>
                        </p>
                    ) : (
                        <p className="m-0 text-sm text-foreground/70">{t("missionUnavailable")}</p>
                    )}
                </section>
            )}

            <h2 className="overline mb-3">{t("stepsHeading")}</h2>
            <ol className="m-0 grid list-none gap-3 p-0">
                {lane.steps.map((s, i) => (
                    <LaneStepItem
                        key={s.id}
                        slug={slug}
                        stepId={s.id}
                        index={i + 1}
                        title={s.title}
                        kind={s.kind}
                        initialDone={progress.doneIds.includes(s.id)}
                        linkHref={s.linkHref}
                        linkLabel={s.linkLabel}
                        markDone={t("markDone")}
                        markUndone={t("markUndone")}
                        submitHint={t("submitStepHint")}
                        submitHref={missionHref}
                        errorLabel={t("saveError")}
                    >
                        {s.body.trim() && <HandbookMarkdown content={renderPlaceholders(s.body, facts)} />}
                    </LaneStepItem>
                ))}
            </ol>

            {stretch.length > 0 && (
                <section className="mt-8 grid gap-2">
                    <h2 className="overline m-0">{t("stretchHeading")}</h2>
                    <ul className="m-0 grid list-none gap-1 p-0">
                        {stretch.map((m) => (
                            <li key={m.id}>
                                <Link href={`/missions#mission-${m.id}`} className="underline underline-offset-2">{m.title}</Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {lane.crewId && (
                <section className={`${paperCard} mt-8 grid gap-2 p-5`}>
                    <h2 className="overline m-0">{t("crewHeading")}</h2>
                    <Link href="/crews" className={`${pillOutline} w-fit`}>{t("crewCta")}</Link>
                </section>
            )}
        </EditorialPage>
    );
}
