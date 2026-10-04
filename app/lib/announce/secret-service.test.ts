import { describe, it, expect, vi } from "vitest";
import { callSecretServiceAnnounce, getSecretServiceConfig, buildSecretServicePayload } from "./secret-service";

const CFG = { url: "https://script.google.com/macros/s/t/exec", password: "pw", spreadsheetId: "sid" };

describe("SecretService announce call", () => {
  it("builds the announce payload with all Discord posts off", () => {
    expect(buildSecretServicePayload(CFG)).toEqual({
      password: "pw",
      spreadsheetId: "sid",
      action: "announce",
      options: { postGeneral: false, postBand: false, postCrew: false },
    });
  });

  it("returns null config when env is missing", () => {
    expect(getSecretServiceConfig("sid", { ANNOUNCE_WEBAPP_URL: "https://x" })).toBeNull();
  });

  it("parses a direct (non-redirect) JSON response", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true, results: { tweet: { success: true } } })));
    const r = await callSecretServiceAnnounce(CFG, f as unknown as typeof fetch);
    expect(r).toEqual({ success: true, results: { tweet: { success: true } } });
  });

  it("reports a non-JSON response (e.g. an Apps Script HTML error page)", async () => {
    const f = vi.fn(async () => new Response("<html>Script function not found</html>", { status: 200 }));
    const r = await callSecretServiceAnnounce(CFG, f as unknown as typeof fetch);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/non-JSON/);
  });

  it("never throws on network errors", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await callSecretServiceAnnounce(CFG, f as unknown as typeof fetch);
    expect(r).toEqual({ success: false, error: "Could not reach SecretService: ECONNRESET" });
  });
});
