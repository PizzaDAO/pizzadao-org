// app/dashboard/[id]/lib/profile-completion.test.ts
import { describe, it, expect } from "vitest";
import {
    getProfileCompletion,
    PROFILE_STEPS,
    type ProfileCompletionInput,
} from "./profile-completion";
import { resolveNextAction, type NextActionInput } from "./next-action";

function complete(): ProfileCompletionInput {
    return {
        member: { id: "42", crews: ["events"] },
        wallets: { count: 1 },
        x: { connected: true },
    };
}

function empty(): ProfileCompletionInput {
    return {
        member: { id: "42", crews: [] },
        wallets: { count: 0 },
        x: { connected: false },
    };
}

describe("getProfileCompletion", () => {
    it("reports 0 of 3 for a brand-new member, next = join_crew", () => {
        const c = getProfileCompletion(empty());
        expect(c.total).toBe(3);
        expect(c.completed).toBe(0);
        expect(c.percent).toBe(0);
        expect(c.isComplete).toBe(false);
        expect(c.next?.key).toBe("join_crew");
        expect(c.next?.href).toBe("/crew");
    });

    it("lists steps in priority order with labels and hrefs", () => {
        const c = getProfileCompletion(empty());
        expect(c.steps.map((s) => s.key)).toEqual(["join_crew", "connect_wallet", "connect_x"]);
        expect(c.steps.map((s) => s.label)).toEqual(["Join a crew", "Connect a wallet", "Connect X"]);
        expect(c.steps[1].href).toBe("/profile/42");
        expect(c.steps[2].href).toBe("/api/x/login?memberId=42");
    });

    it("counts partial progress and floors the percent", () => {
        const input = empty();
        input.member.crews = ["tech"];
        const c = getProfileCompletion(input);
        expect(c.completed).toBe(1);
        expect(c.percent).toBe(33);
        expect(c.next?.key).toBe("connect_wallet");

        input.wallets.count = 2;
        const c2 = getProfileCompletion(input);
        expect(c2.completed).toBe(2);
        expect(c2.percent).toBe(66);
        expect(c2.next?.key).toBe("connect_x");
    });

    it("next is the first *incomplete* step even if later ones are done", () => {
        const input = complete();
        input.member.crews = [];
        const c = getProfileCompletion(input);
        expect(c.completed).toBe(2);
        expect(c.next?.key).toBe("join_crew");
    });

    it("reports 100% and next = null when every step is done", () => {
        const c = getProfileCompletion(complete());
        expect(c.completed).toBe(3);
        expect(c.percent).toBe(100);
        expect(c.isComplete).toBe(true);
        expect(c.next).toBeNull();
        expect(c.steps.every((s) => s.done)).toBe(true);
    });

    it("url-encodes the member id in the X login href", () => {
        const input = empty();
        input.member.id = "a b&c";
        const c = getProfileCompletion(input);
        expect(c.steps[2].href).toBe("/api/x/login?memberId=a%20b%26c");
    });
});

describe("next-action shares PROFILE_STEPS", () => {
    function nextActionInput(p: ProfileCompletionInput): NextActionInput {
        return {
            ...p,
            level: {
                current: 1,
                title: null,
                completedThisLevel: 0,
                totalThisLevel: 0,
                nextMission: null,
                awaitingReview: false,
            },
            vouches: { total: 10 },
            notifications: { unread: 0, top: null },
        };
    }

    it("resolveNextAction surfaces the same step as the meter's next step", () => {
        const cases: ProfileCompletionInput[] = [
            empty(),
            { ...complete(), wallets: { count: 0 } },
            { ...complete(), x: { connected: false } },
        ];
        for (const input of cases) {
            const meterNext = getProfileCompletion(input).next!;
            const action = resolveNextAction(nextActionInput(input));
            expect(action.kind).toBe(meterNext.key);
            expect(action.primaryCta.href).toBe(meterNext.href);
        }
    });

    it("resolveNextAction moves past setup once the profile is complete", () => {
        const action = resolveNextAction(nextActionInput(complete()));
        expect(PROFILE_STEPS.map((s) => s.key)).not.toContain(action.kind);
    });
});
