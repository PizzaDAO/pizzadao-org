// app/dashboard/[id]/lib/profile-completion.ts
//
// jalapeno-34126 — Single source of truth for the "profile setup" steps.
//
// These are the same setup steps `resolveNextAction` (./next-action.ts) ranks
// first: join a crew → connect a wallet → connect X. `resolveNextAction`
// iterates `PROFILE_STEPS` in order and surfaces the first incomplete one, and
// `getProfileCompletion` summarises the same list for the dashboard's
// completion meter and the one-time "profile complete" celebration.
//
// Pure and synchronous — safe on the server (dashboard-summary route) and in
// unit tests. Adding a step here automatically updates the next-action panel,
// the meter, and the celebration trigger.
//
// NOTE: the prod backfill in
// prisma/migrations/20260929000000_profile_completed_celebrated_at mirrors the
// DB-visible part of these rules (wallet + X). If you add a step, revisit it.

/** Just the fields the setup steps look at — a structural subset of NextActionInput. */
export interface ProfileCompletionInput {
    member: { id: string; crews: string[] };
    wallets: { count: number };
    x: { connected: boolean };
}

export type ProfileStepKey = "join_crew" | "connect_wallet" | "connect_x";

export interface ProfileStepDefinition {
    key: ProfileStepKey;
    /** Short checklist label, e.g. for the meter / celebration. */
    label: string;
    isDone: (input: ProfileCompletionInput) => boolean;
    href: (memberId: string) => string;
    /** Copy used when this step is surfaced as the dashboard's next action. */
    nextAction: {
        headline: string;
        body?: string;
        ctaLabel: string;
    };
}

/** Ordered by priority — the first incomplete step is the "next" one. */
export const PROFILE_STEPS: readonly ProfileStepDefinition[] = [
    {
        key: "join_crew",
        label: "Join a crew",
        isDone: ({ member }) => Array.isArray(member.crews) && member.crews.length > 0,
        href: () => "/crews",
        nextAction: {
            headline: "Welcome — pick a crew to get started",
            body: "Crews are how members coordinate work across the DAO.",
            ctaLabel: "Join your first crew",
        },
    },
    {
        key: "connect_wallet",
        label: "Connect a wallet",
        isDone: ({ wallets }) => wallets.count > 0,
        href: (memberId) => `/profile/${memberId}`,
        nextAction: {
            headline: "Link a wallet to display your PizzaDAO POAPs and NFTs",
            ctaLabel: "Connect a wallet",
        },
    },
    {
        key: "connect_x",
        label: "Connect X",
        isDone: ({ x }) => x.connected,
        href: (memberId) => `/api/x/login?memberId=${encodeURIComponent(memberId)}`,
        nextAction: {
            headline: "Connect X so the community can vouch for you",
            ctaLabel: "Connect X",
        },
    },
];

export interface ProfileStep {
    key: ProfileStepKey;
    label: string;
    done: boolean;
    href: string;
}

export interface ProfileCompletion {
    steps: ProfileStep[];
    completed: number;
    total: number;
    /** 0–100, rounded down so the meter never shows 100 before it's true. */
    percent: number;
    isComplete: boolean;
    /** First incomplete step, or null when complete. */
    next: ProfileStep | null;
}

export function getProfileCompletion(input: ProfileCompletionInput): ProfileCompletion {
    const steps: ProfileStep[] = PROFILE_STEPS.map((def) => ({
        key: def.key,
        label: def.label,
        done: def.isDone(input),
        href: def.href(input.member.id),
    }));
    const total = steps.length;
    const completed = steps.filter((s) => s.done).length;
    const percent = total === 0 ? 100 : Math.floor((completed / total) * 100);
    return {
        steps,
        completed,
        total,
        percent,
        isComplete: completed === total,
        next: steps.find((s) => !s.done) ?? null,
    };
}
