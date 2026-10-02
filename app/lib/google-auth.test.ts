// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GOOGLE_SCOPES,
  __resetGoogleAuthForTests,
  getGoogleAuth,
  getServiceAccountCredentials,
  hasServiceAccountCredentials,
} from "./google-auth";

afterEach(() => {
  vi.unstubAllEnvs();
  __resetGoogleAuthForTests();
});

describe("google-auth", () => {
  it("reuses one client per scope set", () => {
    const a = getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly]);
    const b = getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly]);
    const c = getGoogleAuth([GOOGLE_SCOPES.sheets]);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    // order-insensitive
    expect(getGoogleAuth([GOOGLE_SCOPES.sheets, GOOGLE_SCOPES.sheetsReadonly])).toBe(
      getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly, GOOGLE_SCOPES.sheets]),
    );
  });

  it("parses GOOGLE_SERVICE_ACCOUNT_JSON", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify({ client_email: "bot@example.com" }));
    expect(getServiceAccountCredentials()).toEqual({ client_email: "bot@example.com" });
    expect(hasServiceAccountCredentials()).toBe(true);
  });

  it("reports missing and invalid credentials", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    expect(getServiceAccountCredentials()).toBeUndefined();
    expect(hasServiceAccountCredentials()).toBe(false);

    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "{not json");
    expect(() => getServiceAccountCredentials()).toThrow(/not valid JSON/);
    expect(hasServiceAccountCredentials()).toBe(false);
  });
});
