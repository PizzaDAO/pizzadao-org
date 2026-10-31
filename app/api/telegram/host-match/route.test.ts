import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: vi.fn() }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42") }));
vi.mock("@/app/lib/rate-limit", () => ({
    checkKeyedRateLimit: vi.fn().mockResolvedValue({ success: true }),
    rateLimitResponse: vi.fn(),
}));
const getCard = vi.fn();
const startConfirmation = vi.fn();
const declineMatch = vi.fn();
vi.mock("@/app/lib/telegram/host-match-consent", () => ({
    getCard: (...a: unknown[]) => getCard(...a),
    startConfirmation: (...a: unknown[]) => startConfirmation(...a),
    declineMatch: (...a: unknown[]) => declineMatch(...a),
}));

import { GET, POST } from "./route";

const savedEnv = { ...process.env };

const post = (body: unknown) =>
    new Request("http://localhost/api/telegram/host-match", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" },
        body: JSON.stringify(body),
    });

describe("/api/telegram/host-match", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSession.mockResolvedValue({ discordId: "d1", createdAt: Date.now() });
        process.env.NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME = "sender_bot";
        getCard.mockResolvedValue({ state: "pending", handleHint: "ab", canSend: true });
    });
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it("GET returns the card and does not expose the sender bot", async () => {
        const body = await (await GET()).json();
        expect(body).toMatchObject({ enabled: true, state: "pending", handleHint: "ab" });
        expect(body).not.toHaveProperty("senderBot");
    });

    it("POST returns the sender bot handle so the card can link to it", async () => {
        startConfirmation.mockResolvedValue("not-started");
        const res = await POST(post({ action: "confirm" }));
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ ok: false, result: "not-started", senderBot: "sender_bot" });
    });

    it("POST returns a null sender bot when none is configured", async () => {
        delete process.env.NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME;
        startConfirmation.mockResolvedValue("sent");
        const body = await (await POST(post({ action: "send-confirmation" }))).json();
        expect(body.senderBot).toBeNull();
    });
});
