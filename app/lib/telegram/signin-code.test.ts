import { describe, it, expect, vi, beforeEach } from "vitest";

// A small in-memory stand-in for the table that understands the where-clauses the lib uses, so the
// conditional updates (the races) are really exercised.
type Row = Record<string, unknown> & { codeHash: string; createdAt: Date };
const store = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, cond]) => {
        const v = row[k] ?? null;
        if (cond === null) return v === null;
        if (cond && typeof cond === "object" && !(cond instanceof Date)) {
            const c = cond as { not?: unknown; gt?: Date; lt?: Date };
            if ("not" in c) return v !== c.not;
            if (c.gt) return v instanceof Date && v.getTime() > c.gt.getTime();
            if (c.lt) return v instanceof Date && v.getTime() < c.lt.getTime();
        }
        return v === cond;
    });
}

vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramSignInRequest: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                store.rows.push({ claimedAt: null, approvedAt: null, consumedAt: null, cancelledAt: null, tgId: null, discordId: null, ref: null, ...data, createdAt: new Date() } as unknown as Row);
            },
            findUnique: async ({ where }: { where: Record<string, unknown> }) => store.rows.find((r) => matches(r, where)) ?? null,
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                const hit = store.rows.filter((r) => matches(r, where));
                hit.forEach((r) => Object.assign(r, data));
                return { count: hit.length };
            },
            count: async ({ where }: { where: Record<string, unknown> }) => store.rows.filter((r) => matches(r, where)).length,
            deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
                const before = store.rows.length;
                store.rows = store.rows.filter((r) => !matches(r, where));
                return { count: before - store.rows.length };
            },
        },
    },
}));

import {
    answerSignin,
    cancelSignin,
    claimSignin,
    consumeSignin,
    createSigninRequest,
    numberChoices,
    parseSigninCookie,
    SIGNIN_MAX_CLAIMS_PER_HOUR,
} from "./signin-code";

const T0 = 1_800_000_000_000;
const tgA = "777";

async function start(returnTo?: unknown, now = T0) {
    const made = await createSigninRequest({ returnTo, now });
    return { ...made, code: made.code };
}
async function claimed(now = T0) {
    const made = await start(undefined, now);
    const claim = await claimSignin(made.code, tgA, "d1", now);
    if (claim.status !== "claimed") throw new Error("claim failed");
    return { made, claim };
}

beforeEach(() => {
    store.rows = [];
});

describe("sign-in requests", () => {
    it("makes a hash-only request with a 2-digit number and a 5-minute life", async () => {
        const made = await start();
        expect(made.matchNumber).toBeGreaterThanOrEqual(10);
        expect(made.matchNumber).toBeLessThanOrEqual(99);
        expect(made.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(made.expiresAt.getTime()).toBe(T0 + 5 * 60 * 1000);
        const row = store.rows[0];
        expect(JSON.stringify(row)).not.toContain(made.code);
        expect(JSON.stringify(row)).not.toContain(made.cookieValue.split(".")[1]);
        expect(parseSigninCookie(made.cookieValue)).toEqual({ code: made.code, secret: made.cookieValue.split(".")[1] });
        expect(parseSigninCookie("garbage")).toBeNull();
    });

    it("cleans returnTo: local pages only", async () => {
        await start("/profile/77");
        await start("https://evil.example/x");
        await start("//evil.example");
        await start("/api/admin");
        expect(store.rows.map((r) => r.returnTo)).toEqual(["/profile/77", null, null, null]);
    });

    it("offers the real number plus two different decoys", () => {
        for (let i = 0; i < 50; i++) {
            const picks = numberChoices(42);
            expect(new Set(picks).size).toBe(3);
            expect(picks).toContain(42);
        }
    });
});

describe("claiming", () => {
    it("the first claimant wins and a second Telegram user cannot take it", async () => {
        const { made, claim } = await claimed();
        expect(claim.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(await claimSignin(made.code, "999", "d2", T0 + 1000)).toEqual({ status: "expired" });
        expect(store.rows[0].tgId).toBe(tgA);
    });

    it("the same user pressing Start again gets the same ref", async () => {
        const { made, claim } = await claimed();
        expect(await claimSignin(made.code, tgA, "d1", T0 + 1000)).toEqual({ status: "claimed", ref: claim.ref, matchNumber: made.matchNumber });
    });

    it("refuses an expired, malformed or unknown code", async () => {
        const made = await start();
        expect(await claimSignin(made.code, tgA, "d1", T0 + 5 * 60 * 1000)).toEqual({ status: "expired" });
        expect(await claimSignin("short", tgA, "d1", T0)).toEqual({ status: "expired" });
        expect(await claimSignin("B".repeat(43), tgA, "d1", T0)).toEqual({ status: "expired" });
    });

    it("limits how many requests one Telegram account may claim per hour", async () => {
        for (let i = 0; i < SIGNIN_MAX_CLAIMS_PER_HOUR; i++) {
            const m = await start(undefined, Date.now());
            expect((await claimSignin(m.code, tgA, "d1", Date.now())).status).toBe("claimed");
        }
        const extra = await start(undefined, Date.now());
        expect(await claimSignin(extra.code, tgA, "d1", Date.now())).toEqual({ status: "limited" });
        expect(store.rows.at(-1)?.tgId).toBeNull();
    });
});

describe("answering", () => {
    it("the right number approves once", async () => {
        const { made, claim } = await claimed();
        expect(await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000)).toBe("approved");
        expect(await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 2000)).toBe("ignore");
    });

    it("a wrong number cancels, and the right number afterwards does nothing", async () => {
        const { made, claim } = await claimed();
        const wrong = made.matchNumber === 10 ? 11 : 10;
        expect(await answerSignin(claim.ref, tgA, wrong, T0 + 1000)).toBe("cancelled");
        expect(store.rows[0].cancelledAt).toBeInstanceOf(Date);
        expect(await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 2000)).toBe("ignore");
        expect(store.rows[0].approvedAt).toBeNull();
    });

    it("someone else's tap is ignored and changes nothing", async () => {
        const { made, claim } = await claimed();
        expect(await answerSignin(claim.ref, "999", made.matchNumber, T0 + 1000)).toBe("ignore");
        expect(await answerSignin(claim.ref, "999", 0, T0 + 1000)).toBe("ignore");
        expect(store.rows[0].approvedAt).toBeNull();
        expect(store.rows[0].cancelledAt).toBeNull();
    });

    it("an expired request cannot be approved", async () => {
        const { made, claim } = await claimed();
        expect(await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 5 * 60 * 1000)).toBe("expired");
        expect(await answerSignin("nope", tgA, 1, T0)).toBe("ignore");
        expect(await answerSignin("Z".repeat(22), tgA, 1, T0)).toBe("expired");
    });
});

describe("consuming (the browser's poll)", () => {
    it("waits until approved, then signs in exactly once (replay is refused)", async () => {
        const { made, claim } = await claimed();
        expect(await consumeSignin(made.cookieValue, T0 + 500)).toEqual({ status: "pending" });
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000);
        expect(await consumeSignin(made.cookieValue, T0 + 2000)).toEqual({ status: "approved", discordId: "d1", returnTo: undefined });
        expect(await consumeSignin(made.cookieValue, T0 + 3000)).toEqual({ status: "none" });
    });

    it("gives the cleaned returnTo back", async () => {
        const made = await start("/profile/77");
        const claim = await claimSignin(made.code, tgA, "d1", T0);
        if (claim.status !== "claimed") throw new Error("claim failed");
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1);
        expect(await consumeSignin(made.cookieValue, T0 + 2)).toMatchObject({ status: "approved", returnTo: "/profile/77" });
    });

    it("a different browser (wrong cookie secret) never gets the session, even with the real code", async () => {
        const { made, claim } = await claimed();
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000);
        const stolen = `${made.code}.${"S".repeat(43)}`;
        expect(await consumeSignin(stolen, T0 + 2000)).toEqual({ status: "none" });
        expect(await consumeSignin(undefined, T0 + 2000)).toEqual({ status: "none" });
        expect(store.rows[0].consumedAt).toBeNull();
        expect(await consumeSignin(made.cookieValue, T0 + 3000)).toMatchObject({ status: "approved" });
    });

    it("reports expiry and cancellation", async () => {
        const a = await claimed();
        expect(await consumeSignin(a.made.cookieValue, T0 + 5 * 60 * 1000 + 1)).toEqual({ status: "expired" });
        store.rows = [];
        const b = await claimed();
        await answerSignin(b.claim.ref, tgA, b.made.matchNumber === 10 ? 11 : 10, T0 + 1000);
        expect(await consumeSignin(b.made.cookieValue, T0 + 2000)).toEqual({ status: "cancelled" });
    });

    it("an approval that expires before the poll arrives is not spent", async () => {
        const { made, claim } = await claimed();
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000);
        expect(await consumeSignin(made.cookieValue, T0 + 6 * 60 * 1000)).toEqual({ status: "expired" });
    });

    it("the precheck can refuse (and ends the request), or ask for a retry (and leaves it)", async () => {
        const { made, claim } = await claimed();
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000);
        expect(await consumeSignin(made.cookieValue, T0 + 2000, async () => "retry")).toEqual({ status: "pending" });
        expect(store.rows[0].consumedAt).toBeNull();
        expect(await consumeSignin(made.cookieValue, T0 + 2500, async () => "telegram_left_server")).toEqual({ status: "refused", reason: "telegram_left_server" });
        expect(await consumeSignin(made.cookieValue, T0 + 3000)).toEqual({ status: "cancelled" });
    });

    it("two polls racing: only one gets the session", async () => {
        const { made, claim } = await claimed();
        await answerSignin(claim.ref, tgA, made.matchNumber, T0 + 1000);
        const both = await Promise.all([consumeSignin(made.cookieValue, T0 + 2000), consumeSignin(made.cookieValue, T0 + 2000)]);
        expect(both.filter((r) => r.status === "approved")).toHaveLength(1);
    });
});

describe("stop waiting", () => {
    it("deletes this browser's request only", async () => {
        const a = await start();
        const b = await start();
        await cancelSignin(a.cookieValue);
        expect(store.rows).toHaveLength(1);
        await cancelSignin(`${b.code}.${"S".repeat(43)}`);
        expect(store.rows).toHaveLength(1);
        await cancelSignin(undefined);
        expect(store.rows).toHaveLength(1);
    });
});
