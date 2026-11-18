// @vitest-environment node
// Auth and gating of the Discord-side trivia routes: the cron and the recorder's answer intake.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db");
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/app/lib/trivia/cron", () => ({ runTriviaCron: vi.fn(async () => ({ status: "skipped", reason: "discord trivia off on preview" })) }));
vi.mock("@/app/lib/trivia/enabled", () => ({ triviaLive: vi.fn(async () => false), isProductionDeploy: () => false }));
vi.mock("@/app/lib/trivia/channel", () => ({ resolveTriviaChannel: vi.fn(async () => "850000000000000001") }));
vi.mock("@/app/lib/trivia/answer", () => ({ defaultAnswerDeps: vi.fn(() => ({})), processAnswer: vi.fn(async () => ({ status: "wrong" })) }));

import { GET as cronGET } from "@/app/api/cron/trivia/route";
import { POST as answerPOST } from "@/app/api/trivia/discord/answer/route";
import { runTriviaCron } from "@/app/lib/trivia/cron";
import { triviaLive } from "@/app/lib/trivia/enabled";
import { processAnswer } from "@/app/lib/trivia/answer";

const CHAN = "850000000000000001";
const good = { channelId: CHAN, messageId: "850000000000000009", authorId: "310000000000000000", content: "true" };

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { CRON_SECRET: process.env.CRON_SECRET, RECORDER_API_KEY: process.env.RECORDER_API_KEY };
  process.env.CRON_SECRET = "cron-secret";
  process.env.RECORDER_API_KEY = "recorder-key";
  vi.mocked(triviaLive).mockReset();
  vi.mocked(triviaLive).mockResolvedValue(false);
  vi.mocked(processAnswer).mockClear();
  vi.mocked(runTriviaCron).mockClear();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const cron = (auth?: string) => cronGET(new NextRequest("https://x.test/api/cron/trivia", { headers: auth ? { authorization: auth } : {} }));
const answer = (body: unknown, auth?: string) =>
  answerPOST(new Request("https://x.test/api/trivia/discord/answer", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));

describe("GET /api/cron/trivia", () => {
  it("401 without or with a wrong secret, and nothing runs", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer nope")).status).toBe(401);
    expect(runTriviaCron).not.toHaveBeenCalled();
  });

  it("with the secret it runs and answers the result (a preview gets the no-op)", async () => {
    const res = await cron("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped", reason: "discord trivia off on preview" });
  });

  it("no CRON_SECRET configured: nothing is authorized", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron("Bearer cron-secret")).status).toBe(401);
  });
});

describe("POST /api/trivia/discord/answer", () => {
  it("401 without or with a wrong key, before anything is read", async () => {
    expect((await answer(good)).status).toBe(401);
    expect((await answer(good, "Bearer nope")).status).toBe(401);
    expect(triviaLive).not.toHaveBeenCalled();
    expect(processAnswer).not.toHaveBeenCalled();
  });

  it("the cron secret is not the recorder key", async () => {
    expect((await answer(good, "Bearer cron-secret")).status).toBe(401);
  });

  it("400 for a malformed body", async () => {
    for (const bad of [{}, { ...good, channelId: "x" }, { ...good, messageId: 5 }, { ...good, authorId: "" }, { ...good, content: undefined }]) {
      expect((await answer(bad, "Bearer recorder-key")).status).toBe(400);
    }
    expect(processAnswer).not.toHaveBeenCalled();
  });

  it("off (preview, or trivia.enabled off): 200 {status: off}, the answer is not processed", async () => {
    const res = await answer(good, "Bearer recorder-key");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "off" });
    expect(processAnswer).not.toHaveBeenCalled();
  });

  it("on: processes an answer from the trivia channel", async () => {
    vi.mocked(triviaLive).mockResolvedValue(true);
    const res = await answer(good, "Bearer recorder-key");
    expect(await res.json()).toEqual({ ok: true, status: "wrong" });
    expect(processAnswer).toHaveBeenCalledWith({ channelId: CHAN, messageId: good.messageId, discordId: good.authorId, content: "true" }, expect.anything());
  });

  it("on: an answer from any other channel is not processed, whatever the recorder sends", async () => {
    vi.mocked(triviaLive).mockResolvedValue(true);
    const res = await answer({ ...good, channelId: "850000000000000099" }, "Bearer recorder-key");
    expect(await res.json()).toEqual({ ok: true, status: "no_round" });
    expect(processAnswer).not.toHaveBeenCalled();
  });

  it("a failure inside is a 500 the recorder will retry", async () => {
    vi.mocked(triviaLive).mockResolvedValue(true);
    vi.mocked(processAnswer).mockRejectedValueOnce(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await answer(good, "Bearer recorder-key")).status).toBe(500);
  });
});
