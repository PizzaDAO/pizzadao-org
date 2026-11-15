// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => { process.env.SESSION_SECRET ||= "test-secret"; return { used: vi.fn(), verify: vi.fn() }; });
vi.mock("@/app/lib/magic-login", () => ({ anyMagicLinkUsed: mocks.used }));
vi.mock("@/app/lib/session", () => ({ COOKIE_NAME: "pizzadao_session", verifySession: mocks.verify }));
import { GET } from "./route";
import { addPendingId } from "@/app/lib/magic-login-pending";

const get = (cookie?: string) => GET(new Request("https://app.example/api/auth/magic-login/status", { headers: cookie ? { cookie } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockImplementation((t?: string) => (t === "good" ? { discordId: "123", createdAt: Date.now() } : null));
  mocks.used.mockResolvedValue(false);
});

describe("magic login status", () => {
  it("reports a session that appeared in this browser (link opened in another tab)", async () => {
    const res = await get("pizzadao_session=good");
    expect(await res.json()).toEqual({ loggedIn: true, openedElsewhere: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.used).not.toHaveBeenCalled();
  });
  it("reports the newest link this browser asked for as opened elsewhere once it is used", async () => {
    mocks.used.mockResolvedValue(true);
    const pending = encodeURIComponent(addPendingId(addPendingId(null, "tok1"), "tok2"));
    const res = await get(`pd_magic_pending=${pending}`);
    expect(await res.json()).toEqual({ loggedIn: false, openedElsewhere: true });
    expect(mocks.used).toHaveBeenCalledWith(["tok2"]);
  });
  it("ignores forged or missing pending cookies", async () => {
    await get("pd_magic_pending=tok1:forged");
    expect(mocks.used).toHaveBeenCalledWith([]);
    const res = await get();
    expect(await res.json()).toEqual({ loggedIn: false, openedElsewhere: false });
  });
  it("fails quiet when the lookup fails", async () => {
    mocks.used.mockRejectedValue(new Error("db down"));
    const res = await get(`pd_magic_pending=${encodeURIComponent(addPendingId(null, "tok1"))}`);
    expect(await res.json()).toEqual({ loggedIn: false, openedElsewhere: false });
  });
});
