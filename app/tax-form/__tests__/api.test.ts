import { describe, it, expect, vi, afterEach } from "vitest";
import { TAX_FORM_API_BASE, getRequest, saveDraft, submit } from "../_lib/api";

const FAKE = "fake-token/with space-0000000000";

function stub(res: { ok: boolean; status: number; body: unknown }) {
  const fn = vi.fn().mockResolvedValue({ ok: res.ok, status: res.status, json: async () => res.body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("tax-form api", () => {
  it("defaults to the rsv-pizza API with no trailing slash", () => {
    expect(TAX_FORM_API_BASE).toBe("https://api.rsv.pizza");
  });

  it("encodes the token and sends privacy options on GET", async () => {
    const f = stub({ ok: true, status: 200, body: { requester: "Rare Pizzas" } });
    await getRequest(FAKE);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://api.rsv.pizza/api/tax-form-requests/${encodeURIComponent(FAKE)}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("POSTs {formType, formData} to draft and submit", async () => {
    const f = stub({ ok: true, status: 200, body: { ok: true } });
    await saveDraft("t".repeat(24), "w9", { name: "A" });
    await submit("t".repeat(24), "w8ben", { name: "B" });
    expect(f.mock.calls[0][0]).toMatch(/\/draft$/);
    expect(f.mock.calls[1][0]).toMatch(/\/submit$/);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ formType: "w9", formData: { name: "A" } });
    expect(f.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("parses the error code", async () => {
    stub({ ok: false, status: 404, body: { error: { message: "nope", code: "INVALID_TOKEN" } } });
    await expect(getRequest("x".repeat(24))).rejects.toMatchObject({ code: "INVALID_TOKEN", message: "nope", status: 404 });
  });

  it("maps a 429 without a body code to RATE_LIMITED", async () => {
    stub({ ok: false, status: 429, body: null });
    await expect(getRequest("x".repeat(24))).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("maps a network failure to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    await expect(getRequest("x".repeat(24))).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
