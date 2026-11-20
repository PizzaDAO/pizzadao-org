// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/auth-guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/app/lib/trivia/reports", () => ({ setQuestionDisabled: vi.fn(async () => true), closeReports: vi.fn(async () => 2) }));
vi.mock("@/app/lib/trivia/suggestions", () => ({
  closeSuggestion: vi.fn(async () => true),
  addSuggestionToBank: vi.fn(async () => ({ status: "added", questionId: "pd-916", existed: false })),
}));

import { POST } from "./route";
import { requireAdmin } from "@/app/lib/auth-guards";
import { closeReports, setQuestionDisabled } from "@/app/lib/trivia/reports";
import { addSuggestionToBank, closeSuggestion } from "@/app/lib/trivia/suggestions";

const call = (body: unknown) => POST(new Request("https://x.test/api/admin/trivia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, session: { discordId: "900000000000000001" } } as never);
  vi.mocked(closeSuggestion).mockClear();
  vi.mocked(closeSuggestion).mockResolvedValue(true);
  vi.mocked(setQuestionDisabled).mockClear();
  vi.mocked(closeReports).mockClear();
});

describe("POST /api/admin/trivia: suggestions", () => {
  it("a non-admin cannot close a suggestion", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } as never);
    expect((await call({ action: "suggestion-added", suggestionId: 3 })).status).toBe(403);
    expect(closeSuggestion).not.toHaveBeenCalled();
  });

  it("mark added and dismiss close the suggestion with the right status, touching no question or setting", async () => {
    expect(await (await call({ action: "suggestion-added", suggestionId: 3 })).json()).toEqual({ ok: true });
    expect(closeSuggestion).toHaveBeenLastCalledWith(3, "added");
    expect(await (await call({ action: "suggestion-dismiss", suggestionId: 4 })).json()).toEqual({ ok: true });
    expect(closeSuggestion).toHaveBeenLastCalledWith(4, "dismissed");
    expect(setQuestionDisabled).not.toHaveBeenCalled();
    expect(closeReports).not.toHaveBeenCalled();
  });

  it("Add to bank creates the draft as the admin and answers with its id; not open is a 404; non-admins never reach it", async () => {
    expect(await (await call({ action: "suggestion-add", suggestionId: 3 })).json()).toEqual({ ok: true, questionId: "pd-916", existed: false });
    expect(addSuggestionToBank).toHaveBeenLastCalledWith(3, "900000000000000001");
    vi.mocked(addSuggestionToBank).mockResolvedValueOnce({ status: "not_open" });
    expect((await call({ action: "suggestion-add", suggestionId: 3 })).status).toBe(404);
    vi.mocked(addSuggestionToBank).mockResolvedValueOnce({ status: "failed", error: "The question is not valid", errors: ["x"] });
    expect((await call({ action: "suggestion-add", suggestionId: 3 })).status).toBe(400);
    expect((await call({ action: "suggestion-add", suggestionId: "3" })).status).toBe(400);
    vi.mocked(addSuggestionToBank).mockClear();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } as never);
    expect((await call({ action: "suggestion-add", suggestionId: 3 })).status).toBe(403);
    expect(addSuggestionToBank).not.toHaveBeenCalled();
  });

  it("a bad id is a 400 and an already-closed suggestion a 404", async () => {
    for (const suggestionId of [undefined, "3", 0, -1, 1.5]) expect((await call({ action: "suggestion-dismiss", suggestionId })).status).toBe(400);
    expect(closeSuggestion).not.toHaveBeenCalled();
    vi.mocked(closeSuggestion).mockResolvedValueOnce(false);
    expect((await call({ action: "suggestion-dismiss", suggestionId: 9 })).status).toBe(404);
  });
});
