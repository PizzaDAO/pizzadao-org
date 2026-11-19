import Image from "next/image";
import Link from "next/link";
import { isOptimizableImage } from "@/app/lib/image-hosts";
import { DEFAULT_PFP_ALT, pfpOrDefault } from "@/app/lib/pfp-default";
import { MemberHoverCard } from "../profile/MemberHoverCard";
import type { Attendee } from "@/app/lib/calls/attendees";

/** Chips shown before the rest fold into a "show more" disclosure. */
export const ATTENDEE_VISIBLE = 24;

const chip = "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-foreground/15 bg-background px-3 text-sm";

function Chip({ a }: { a: Attendee }) {
    const body = (
        <>
            <Image src={pfpOrDefault(a.pfpUrl)} alt={a.pfpUrl ? "" : DEFAULT_PFP_ALT} width={28} height={28} loading="lazy" unoptimized={!isOptimizableImage(pfpOrDefault(a.pfpUrl))} className="h-7 w-7 shrink-0 rounded-full object-cover" />
            <span className="min-w-0 truncate">{a.name}</span>
        </>
    );
    return a.memberId ? (
        <MemberHoverCard memberId={a.memberId}>
            <Link href={`/profile/${encodeURIComponent(a.memberId)}`} className={`${chip} hover:border-tomato-readable hover:text-tomato-readable`}>
                {body}
            </Link>
        </MemberHoverCard>
    ) : (
        <span className={chip}>{body}</span>
    );
}

export default function AttendeeChips({ attendees, label, showMore }: { attendees: Attendee[]; label: string; showMore: (rest: number) => string }) {
    if (attendees.length === 0) return null;
    const head = attendees.slice(0, ATTENDEE_VISIBLE);
    const rest = attendees.slice(ATTENDEE_VISIBLE);
    return (
        <section className="mb-8 grid gap-2" aria-label={label}>
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-foreground/60">{label}</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {head.map((a, i) => (
                    <li key={i} className="min-w-0 max-w-full"><Chip a={a} /></li>
                ))}
            </ul>
            {rest.length > 0 && (
                <details className="grid gap-2">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">{showMore(rest.length)}</summary>
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                        {rest.map((a, i) => (
                            <li key={i} className="min-w-0 max-w-full"><Chip a={a} /></li>
                        ))}
                    </ul>
                </details>
            )}
        </section>
    );
}
