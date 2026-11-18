import { describe, it, expect, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTH_HINT_COOKIE, parseAuthHint, setAuthHint, knownLoggedOut } from "./auth-hint";

afterEach(() => vi.unstubAllGlobals());

describe("parseAuthHint", () => {
  it("reads 1 and 0", () => {
    expect(parseAuthHint("a=b; pizzadao_auth=1; c=d")).toBe("1");
    expect(parseAuthHint("pizzadao_auth=0")).toBe("0");
  });
  it("treats missing, empty and junk as unknown", () => {
    expect(parseAuthHint("")).toBeNull();
    expect(parseAuthHint(undefined)).toBeNull();
    expect(parseAuthHint("a=b")).toBeNull();
    expect(parseAuthHint("pizzadao_auth=yes")).toBeNull();
    expect(parseAuthHint("xpizzadao_auth=0")).toBeNull();
  });
});

describe("knownLoggedOut", () => {
  it("is true only for an explicit 0", () => {
    vi.stubGlobal("document", { cookie: "pizzadao_auth=0" });
    expect(knownLoggedOut()).toBe(true);
    vi.stubGlobal("document", { cookie: "pizzadao_auth=1" });
    expect(knownLoggedOut()).toBe(false);
    vi.stubGlobal("document", { cookie: "" });
    expect(knownLoggedOut()).toBe(false);
  });
});

describe("setAuthHint", () => {
  it("is not httpOnly and shares secure/sameSite/path/maxAge with the session cookie", () => {
    const set = vi.fn();
    setAuthHint({ cookies: { set } }, "1", { secure: true, sameSite: "lax", path: "/", maxAge: 99 });
    expect(set).toHaveBeenCalledWith(AUTH_HINT_COOKIE, "1", {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 99,
    });
  });
});

describe("session cookie helpers (real module)", () => {
  it("setSessionCookies writes the httpOnly session and hint 1; clearSessionCookies expires it and writes hint 0", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";
    const { setSessionCookies, clearSessionCookies, COOKIE_NAME } = await import("./session");
    const calls: [string, string, Record<string, unknown>][] = [];
    const res = { cookies: { set: (n: string, v: string, o: Record<string, unknown>) => void calls.push([n, v, o]) } };

    setSessionCookies(res, "tok");
    expect(calls[0][0]).toBe(COOKIE_NAME);
    expect(calls[0][1]).toBe("tok");
    expect(calls[0][2].httpOnly).toBe(true);
    expect(calls[1][0]).toBe(AUTH_HINT_COOKIE);
    expect(calls[1][1]).toBe("1");
    expect(calls[1][2].httpOnly).toBe(false);
    expect(calls[1][2].maxAge).toBe(calls[0][2].maxAge);
    expect(JSON.stringify(calls[1])).not.toContain("tok");

    calls.length = 0;
    clearSessionCookies(res);
    expect(calls[0]).toMatchObject([COOKIE_NAME, "", { maxAge: 0 }]);
    expect(calls[1][0]).toBe(AUTH_HINT_COOKIE);
    expect(calls[1][1]).toBe("0");
  });
});

describe("every login path goes through the helper", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === "node_modules" || f === ".next") return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });

  it("no file outside session.ts sets the session cookie directly", () => {
    const root = join(__dirname, "..");
    const bad = walk(root).filter((f) => {
      if (f === join(__dirname, "session.ts")) return false;
      return /cookies\s*\.\s*set\(\s*COOKIE_NAME|cookies\s*\.\s*set\(\s*["']pizzadao_session["']/.test(readFileSync(f, "utf8"));
    });
    expect(bad).toEqual([]);
  });
});
