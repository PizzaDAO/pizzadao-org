// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/auth-guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/app/lib/trivia/reports", () => ({ setQuestionDisabled: vi.fn(async () => true), closeReports: vi.fn(async () => 2) }));

import { POST } from "./route";
import { requireAdmin } from "@/app/lib/auth-guards";
import { closeReports, setQuestionDisabled } from "@/app/lib/trivia/reports";

const ok = { ok: true as const, session: { discordId: "900000000000000001" } };
const call = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new Request("https://x.test/api/admin/trivia", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdmin).mockResolvedValue(ok as never);
  vi.mocked(setQuestionDisabled).mockClear();
  vi.mocked(closeReports).mockClear();
});

describe("POST /api/admin/trivia", () => {
  it("a non-admin is refused before anything is read or written", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } as never);
    const res = await call({ action: "disable", questionId: "pd-905" });
    expect(res.status).toBe(403);
    expect(setQuestionDisabled).not.toHaveBeenCalled();
  });

  it("needs a JSON body", async () => {
    expect((await call("x", { "content-type": "text/plain" })).status).toBe(415);
    expect((await call("{")).status).toBe(400);
  });

  it("disable writes the pulled list as the admin and closes the question's reports", async () => {
    const res = await call({ action: "disable", questionId: "pd-905" });
    expect(await res.json()).toEqual({ ok: true, changed: true, closed: 2 });
    expect(setQuestionDisabled).toHaveBeenCalledWith("pd-905", true, "900000000000000001");
    expect(closeReports).toHaveBeenCalledWith("pd-905");
  });

  it("enable restores; dismiss only closes the reports", async () => {
    await call({ action: "enable", questionId: "pd-905" });
    expect(setQuestionDisabled).toHaveBeenCalledWith("pd-905", false, "900000000000000001");
    vi.mocked(setQuestionDisabled).mockClear();
    expect(await (await call({ action: "dismiss", questionId: "pd-905" })).json()).toEqual({ ok: true, closed: 2 });
    expect(setQuestionDisabled).not.toHaveBeenCalled();
  });

  it("an unknown question is a 404 and an unknown action a 400", async () => {
    expect((await call({ action: "disable", questionId: "zz-999" })).status).toBe(404);
    expect((await call({ action: "explode", questionId: "pd-905" })).status).toBe(400);
    expect(setQuestionDisabled).not.toHaveBeenCalled();
  });
});
