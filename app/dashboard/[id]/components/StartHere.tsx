// app/dashboard/[id]/components/StartHere.tsx
//
// First-run "Start here" card on /dashboard/[id]: the three things a new member does first
// (check your level, do your next mission, get vouched), each with one button. Shown while
// summary.startHere.enabled (setting dashboard.startHereMaxLevel).
// Uses only data the summary already has; adds no requirements beyond the missions themselves.

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export interface StartHereProps {
    enabled?: boolean;
    memberId: string;
    level: number;
    mission?: { state: "todo" | "pending" | "done"; id?: number; title?: string };
    /** Vouches received from other members. */
    vouchesReceived: number;
}

export function StartHere({ enabled, memberId, level, mission, vouchesReceived }: StartHereProps) {
    const t = useTranslations("dashboard.startHere");
    if (!enabled) return null;

    const steps = [
        {
            key: "level",
            done: false,
            title: t("step1Title"),
            body: t("step1Body", { level }),
            cta: t("step1Cta"),
            href: "/missions",
        },
        {
            key: "mission",
            done: mission?.state === "done",
            title: t("step2Title"),
            body:
                mission?.state === "todo" && mission.title
                    ? t("step2Body", { mission: mission.title })
                    : mission?.state === "pending"
                      ? t("step2BodyPending")
                      : t("step2BodyNone"),
            cta: t("step2Cta"),
            href: mission?.state === "todo" && mission.id != null ? `/missions#mission-${mission.id}` : "/missions",
        },
        {
            key: "vouch",
            done: vouchesReceived > 0,
            title: t("step3Title"),
            body: vouchesReceived > 0 ? t("step3Done") : t("step3Body"),
            cta: t("step3Cta"),
            href: `/profile/${encodeURIComponent(memberId)}`,
        },
    ];

    return (
        <section
            data-testid="start-here"
            className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5"
            aria-label={t("overline")}
        >
            <p className="overline">{t("overline")}</p>
            <h2 className="font-display mt-1 text-2xl font-bold">{t("headline")}</h2>
            <p className="mt-2 text-sm text-foreground/75">{t("intro")}</p>
            <ol className="mt-4 grid gap-3">
                {steps.map((step, i) => (
                    <li
                        key={step.key}
                        data-testid={`start-here-${step.key}`}
                        data-done={step.done ? "true" : "false"}
                        className="grid gap-2 rounded-xl border border-foreground/10 p-4"
                    >
                        <div className="flex items-start gap-3">
                            <span
                                aria-hidden
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-sm font-bold"
                            >
                                {step.done ? "✓" : i + 1}
                            </span>
                            <div className="min-w-0">
                                <h3 className="font-bold leading-snug">
                                    {step.title}
                                    {step.done && <span className="ml-2 text-xs font-normal text-foreground/60">{t("done")}</span>}
                                </h3>
                                <p className="mt-1 break-words text-sm leading-relaxed text-foreground/75">{step.body}</p>
                            </div>
                        </div>
                        <Link href={step.href} className="btn-pill min-h-11 justify-center border border-foreground/20 no-underline">
                            {step.cta}
                        </Link>
                    </li>
                ))}
            </ol>
        </section>
    );
}
