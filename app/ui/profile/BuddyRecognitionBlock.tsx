// app/ui/profile/BuddyRecognitionBlock.tsx
//
// Public buddy recognition on /profile/[id] (behind buddy.publicRecognitionEnabled). The data arrives
// from the server page with public fields only (see app/lib/buddy/recognition.ts); this renders it.
import Link from "next/link";
import type { BuddyRecognition } from "../../lib/buddy/recognition";

export function BuddyRecognitionBlock({ recognition }: { recognition: BuddyRecognition }) {
    const { asBuddy, helpedBy } = recognition;
    if (!asBuddy && !helpedBy) return null;
    return (
        <section
            data-testid="buddy-recognition"
            className="paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
            }}
        >
            <p className="overline text-tomato mb-3">§ Buddy</p>
            {asBuddy ? (
                <p className="m-0 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.7)" }}>
                        Buddy
                    </span>
                    <span>
                        Buddy: helped {asBuddy.helped} {asBuddy.helped === 1 ? "trainee" : "trainees"} reach level {asBuddy.level}
                    </span>
                    <Link href="/buddies" className="text-sm underline">
                        Top buddies
                    </Link>
                </p>
            ) : null}
            {helpedBy ? (
                <p className={`m-0 ${asBuddy ? "mt-2" : ""}`}>
                    Onboarded with help from{" "}
                    <Link href={`/profile/${helpedBy.memberId}`} className="font-semibold underline">
                        {helpedBy.name}
                    </Link>
                </p>
            ) : null}
        </section>
    );
}
