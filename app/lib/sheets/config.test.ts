// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const DEFAULT_MEMBERS = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig() {
  vi.resetModules();
  return import("./config");
}

describe("SHEET_IDS", () => {
  it("exposes a non-empty ID for every sheet", async () => {
    const { SHEET_IDS } = await loadConfig();
    for (const [key, id] of Object.entries(SHEET_IDS)) {
      expect(id, key).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    }
    expect(SHEET_IDS.members).toBe(DEFAULT_MEMBERS);
    expect(SHEET_IDS.announce).toBe(DEFAULT_MEMBERS);
  });

  it("lets env vars override IDs (for staging)", async () => {
    vi.stubEnv("MEMBERS_SHEET_ID", "staging-members-sheet-id-000000");
    vi.stubEnv("MANUALS_SHEET_ID", "  staging-manuals-sheet-id-00000  ");
    const { SHEET_IDS } = await loadConfig();
    expect(SHEET_IDS.members).toBe("staging-members-sheet-id-000000");
    expect(SHEET_IDS.manuals).toBe("staging-manuals-sheet-id-00000");
    // announce stays pinned to the production sheet unless overridden itself
    expect(SHEET_IDS.announce).toBe(DEFAULT_MEMBERS);
  });

  it("ignores empty env overrides", async () => {
    vi.stubEnv("MEMBERS_SHEET_ID", "   ");
    const { SHEET_IDS } = await loadConfig();
    expect(SHEET_IDS.members).toBe(DEFAULT_MEMBERS);
  });

  it("is the only place under app/ that hardcodes a sheet ID", async () => {
    const { SHEET_IDS } = await loadConfig();
    const ids = new Set(Object.values(SHEET_IDS));
    const appDir = path.resolve(__dirname, "../..");
    const configFile = path.resolve(__dirname, "config.ts");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && full !== configFile) {
          const src = fs.readFileSync(full, "utf8");
          for (const id of ids) {
            if (src.includes(id)) offenders.push(`${path.relative(appDir, full)} (${id})`);
          }
        }
      }
    };
    walk(appDir);

    expect(offenders).toEqual([]);
  });
});
