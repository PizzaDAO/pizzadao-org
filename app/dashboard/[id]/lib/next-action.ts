// app/dashboard/[id]/lib/next-action.ts
//
// Pure function: given the data shape produced by /api/dashboard-summary
// (minus the `nextAction` field itself), compute the single highest-priority
// "next action" the dashboard should surface for this member.
//
// Rules are taken from plans/garlic-96648-dashboard-redesign.md §5, applied
// strictly in priority order. The first rule that fires wins; remaining rules
// are skipped. The function is intentionally synchronous and side-effect free
// so it can be safely composed both server-side (in the API route) and from
// unit tests.
//
// The resolver is consumed by the API route in PR2 (this PR) so the server
// returns a precomputed `nextAction`. PR3 will add the client-side
// `NextActionPanel` that renders it. Until that lands, the value is opaque
// to the dashboard page.

export type NextActionKind =
  | "join_crew"
  | "connect_wallet"
  | "connect_x"
  | "submit_mission"
  | "awaiting_review"
  | "get_vouches"
  | "review_notification"
  | "power_user_review"
  | "power_user_discover";

export interface NextAction {
  /** Stable discriminator — used by NextActionPanel (PR3) to pick iconography. */
  kind: NextActionKind;
  /** One-line directive shown in the panel. */
  headline: string;
  /** Optional supporting copy (sentence). */
  body?: string;
  primaryCta: { label: string; href: string };
  /** Optional snooze / dismiss target. */
  secondary?: { label: string; href: string };
}

// ---------------------------------------------------------------------------
// Input shape — the *non-nextAction* parts of DashboardSummary.
// Kept structurally compatible with the API payload so the route can pass
// `summary` straight through without remapping.
// ---------------------------------------------------------------------------

export interface NextActionInput {
  member: { id: string; crews: string[] };
  level: {
    current: number;
    title: string | null;
    completedThisLevel: number;
    totalThisLevel: number;
    nextMission: { id: number; title: string } | null;
    /** True when *all* level-N missions have been submitted but at least one
     * is still PENDING (awaiting reviewer). */
    awaitingReview: boolean;
  };
  vouches: { total: number };
  wallets: { count: number };
  x: { connected: boolean };
  notifications: {
    unread: number;
    /** Single highest-priority unread notification, if any. */
    top: { id: string; title: string; linkUrl: string | null } | null;
  };
  /** Reviewer/admin role lets the power-user CTA point at the review queue. */
  isReviewer?: boolean;
}

/**
 * Resolve the single next action for the dashboard.
 *
 * Priority order (plan §5):
 *   1. Just-onboarded (no crews) → join a crew
 *   2. Has crews, no wallet → connect wallet
 *   3. Has wallet, no X → connect X
 *   4. Has next mission to submit → submit mission
 *   5. All level missions submitted, awaiting review → check progress
 *   6. < 3 vouches → get vouches
 *   7. Important unread notification → review notification
 *   8. Power user fallback → review (admin) or discover bounties
 */
export function resolveNextAction(input: NextActionInput): NextAction {
  const { member, level, vouches, wallets, x, notifications, isReviewer } = input;

  // 1. Just-onboarded
  if (!member.crews || member.crews.length === 0) {
    return {
      kind: "join_crew",
      headline: "Welcome — pick a crew to get started",
      body: "Crews are how members coordinate work across the DAO.",
      primaryCta: { label: "Join your first crew", href: "/crew" },
    };
  }

  // 2. No wallet
  if (wallets.count === 0) {
    return {
      kind: "connect_wallet",
      headline: "Link a wallet to collect POAPs and NFTs",
      primaryCta: { label: "Connect a wallet", href: `/profile/${member.id}` },
    };
  }

  // 3. No X account connected
  if (!x.connected) {
    return {
      kind: "connect_x",
      headline: "Connect X so the community can vouch for you",
      primaryCta: {
        label: "Connect X",
        href: `/api/x/login?memberId=${encodeURIComponent(member.id)}`,
      },
    };
  }

  // 4. Mission ready to submit
  if (level.nextMission) {
    return {
      kind: "submit_mission",
      headline: "Your next mission is ready",
      body: level.nextMission.title,
      primaryCta: {
        label: `Submit Level ${level.current} mission`,
        href: `/missions#mission-${level.nextMission.id}`,
      },
    };
  }

  // 5. Awaiting review
  if (level.awaitingReview) {
    return {
      kind: "awaiting_review",
      headline: "Waiting on review — keep building",
      body: `Level ${level.current} missions submitted.`,
      primaryCta: { label: `Check Level ${level.current} progress`, href: "/missions" },
    };
  }

  // 6. Few vouches
  if (vouches.total < 3) {
    return {
      kind: "get_vouches",
      headline: "Build your reputation — ask 3 members to vouch",
      primaryCta: { label: "Get vouches", href: "/vouches/discover" },
    };
  }

  // 7. Unread notification (treat any unread top-notification as important —
  //    the notification system already filters by importance upstream).
  if (notifications.top) {
    const excerpt = truncate(notifications.top.title, 60);
    return {
      kind: "review_notification",
      headline: excerpt,
      primaryCta: {
        label: "Review notification",
        href: notifications.top.linkUrl || "/missions",
      },
    };
  }

  // 8. Power user — admins get the review queue; others get discovery.
  if (isReviewer) {
    return {
      kind: "power_user_review",
      headline: "You're set. Pay it forward.",
      body: "Help review pending missions.",
      primaryCta: { label: "Help review missions", href: "/missions" },
    };
  }

  return {
    kind: "power_user_discover",
    headline: "You're set. Pay it forward.",
    primaryCta: { label: "Discover bounties", href: "/bounties" },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
