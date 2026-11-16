"use client";

// app/ui/profile/DiscordActivityBlock.tsx
//
// "Discord activity" block on /profile/[id] and (as a compact line) on the member hover card.
// Data is the public summary from the profile-summary / member-card APIs: month-precision dates and
// public channel names only. Renders nothing when there is no activity (setting off or no data).

import { useLocale, useTranslations } from "next-intl";
import { formatMemberSince } from "@/app/lib/member-since-format";
import { formatMessageCount } from "@/app/lib/discord-activity-format";

export interface DiscordActivityView {
    messages: number;
    since: string | null;
    lastActive: string | null;
    activeMonths: number;
    topChannels: string[];
}

function useActivityText(a: DiscordActivityView) {
    const t = useTranslations("discordActivity");
    const locale = useLocale();
    const count = formatMessageCount(a.messages, locale);
    return {
        messages: count.compact ? t("messagesCompact", { count: count.text }) : t("messages", { count: a.messages }),
        since: formatMemberSince(a.since, locale),
        last: formatMemberSince(a.lastActive, locale),
        months: a.activeMonths > 0 ? t("activeMonths", { count: a.activeMonths }) : "",
        channels: a.topChannels.map((c) => `#${c}`).join(", "),
        t,
    };
}

export function DiscordActivityBlock({ activity }: { activity: DiscordActivityView | null | undefined }) {
    if (!activity || activity.messages <= 0) return null;
    return <DiscordActivityBody activity={activity} />;
}

function DiscordActivityBody({ activity }: { activity: DiscordActivityView }) {
    const x = useActivityText(activity);
    const rows: Array<[string, string]> = [];
    if (x.since) rows.push([x.t("since"), x.since]);
    if (x.last) rows.push([x.t("lastActive"), x.last]);
    if (x.months) rows.push([x.t("months"), x.months]);
    if (x.channels) rows.push([x.t("topChannels"), x.channels]);
    return (
        <section
            data-testid="discord-activity"
            className="paper-soft rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <p className="overline text-tomato mb-3">{x.t("title")}</p>
            <p data-testid="discord-activity-messages" className="m-0 text-2xl font-semibold">
                {x.messages}
            </p>
            {rows.length > 0 && (
                <dl className="mt-3 mb-0 grid gap-1 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label} className="flex flex-wrap gap-x-2">
                            <dt className="text-foreground/60">{label}</dt>
                            <dd className="m-0 font-medium">{value}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    );
}

/** The compact hover-card line: "757 messages · since March 2021 · last active May 2026". */
export function DiscordActivityLine({ activity }: { activity: DiscordActivityView | null | undefined }) {
    if (!activity || activity.messages <= 0) return null;
    return <DiscordActivityLineBody activity={activity} />;
}

function DiscordActivityLineBody({ activity }: { activity: DiscordActivityView }) {
    const x = useActivityText(activity);
    const parts = [x.messages];
    if (x.since) parts.push(x.t("sinceShort", { date: x.since }));
    if (x.last) parts.push(x.t("lastActiveShort", { date: x.last }));
    if (x.months) parts.push(x.months);
    return (
        <span data-testid="member-card-discord" className="block text-xs text-foreground/65">
            <span className="block">
                {x.t("title")}: {parts.join(" · ")}
            </span>
            {x.channels && <span className="block truncate">{x.channels}</span>}
        </span>
    );
}
