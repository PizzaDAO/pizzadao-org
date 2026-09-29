// app/dashboard/[id]/lib/next-action.test.ts
import { describe, it, expect } from "vitest";
import { resolveNextAction, type NextActionInput } from "./next-action";

// Minimal base input — represents a "fully set up" power user.
// Each scenario clones this and overrides only the fields that matter.
function baseInput(): NextActionInput {
    return {
        member: { id: "42", crews: ["events", "tech"] },
        level: {
            current: 5,
            title: "Capo",
            completedThisLevel: 3,
            totalThisLevel: 3,
            nextMission: null,
            awaitingReview: false,
        },
        vouches: { total: 10 },
        wallets: { count: 1 },
        x: { connected: true },
        notifications: { unread: 0, top: null },
        isReviewer: false,
    };
}

describe("resolveNextAction", () => {
    it("returns join_crew when member has no crews", () => {
        const input = baseInput();
        input.member.crews = [];
        const action = resolveNextAction(input);
        expect(action.kind).toBe("join_crew");
        expect(action.primaryCta.href).toBe("/crew");
    });

    it("returns connect_wallet when member has crews but no wallet", () => {
        const input = baseInput();
        input.wallets.count = 0;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("connect_wallet");
        expect(action.primaryCta.href).toContain("/profile/");
    });

    it("returns connect_x when wallet present but X not connected", () => {
        const input = baseInput();
        input.x.connected = false;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("connect_x");
        expect(action.primaryCta.href).toContain("/api/x/login");
        expect(action.primaryCta.href).toContain("memberId=42");
    });

    it("returns submit_mission when next mission is available", () => {
        const input = baseInput();
        input.level.nextMission = { id: 14, title: "Post your first vouch" };
        const action = resolveNextAction(input);
        expect(action.kind).toBe("submit_mission");
        expect(action.primaryCta.href).toBe("/missions#mission-14");
        expect(action.body).toBe("Post your first vouch");
    });

    it("returns awaiting_review when all level missions submitted but pending", () => {
        const input = baseInput();
        input.level.nextMission = null;
        input.level.awaitingReview = true;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("awaiting_review");
        expect(action.primaryCta.href).toBe("/missions");
    });

    it("returns get_vouches when vouches < 3", () => {
        const input = baseInput();
        input.vouches.total = 1;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("get_vouches");
        expect(action.primaryCta.href).toBe("/vouches/discover");
    });

    it("returns review_notification when an unread top notification exists", () => {
        const input = baseInput();
        input.notifications = {
            unread: 1,
            top: { id: "n1", title: "Your mission was approved", linkUrl: "/missions/14" },
        };
        const action = resolveNextAction(input);
        expect(action.kind).toBe("review_notification");
        expect(action.primaryCta.href).toBe("/missions/14");
        expect(action.headline).toContain("Your mission was approved");
    });

    it("returns power_user_review for reviewers when all else is satisfied", () => {
        const input = baseInput();
        input.isReviewer = true;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("power_user_review");
        expect(action.primaryCta.href).toBe("/missions");
    });

    it("returns power_user_discover for non-reviewer power users", () => {
        const action = resolveNextAction(baseInput());
        expect(action.kind).toBe("power_user_discover");
        expect(action.primaryCta.href).toBe("/bounties");
    });

    it("respects priority order — no crews beats no wallet", () => {
        const input = baseInput();
        input.member.crews = [];
        input.wallets.count = 0;
        const action = resolveNextAction(input);
        expect(action.kind).toBe("join_crew");
    });

    it("respects priority order — submit_mission beats few vouches", () => {
        const input = baseInput();
        input.vouches.total = 0;
        input.level.nextMission = { id: 7, title: "Say hi in #intros" };
        const action = resolveNextAction(input);
        expect(action.kind).toBe("submit_mission");
    });
});
