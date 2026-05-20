// app/dashboard/[id]/dashboard-no-identity.test.ts
//
// Smoke test guarding PR5 (slice-61816) — the dashboard should no longer
// import or render the identity-editing surfaces. They live on
// /profile/[id]/edit and /me/wallets now.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §7.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const dashboardSource = readFileSync(
    join(__dirname, "page.tsx"),
    "utf-8",
);
const heroSource = readFileSync(
    join(__dirname, "components", "HeroBlock.tsx"),
    "utf-8",
);

describe("dashboard/[id]/page.tsx (post-PR5)", () => {
    it("does not import the moved-out identity editors", () => {
        // Components that were removed from the dashboard. Any direct import
        // means the move didn't actually happen.
        const banned = [
            "SocialAccountLinker",
            "ProfileLinksEditor",
            "WalletManager",
            "POAPCollection",
            "NFTCollection",
            "UnlockTicketCard",
        ];
        for (const name of banned) {
            expect(
                dashboardSource,
                `dashboard still references ${name}`,
            ).not.toMatch(new RegExp(`\\b${name}\\b`));
        }
    });

    it("does not import unused lucide-react Pencil icon", () => {
        expect(dashboardSource).not.toMatch(/from\s+"lucide-react"/);
    });

    it("does not retain inline orgs/skills/X editor state", () => {
        // The dashboard previously held all of these in useState.
        const orphanedState = [
            "editingSkills",
            "skillsInput",
            "skillsSaving",
            "editingOrgs",
            "orgsInput",
            "orgsSaving",
            "xDisconnecting",
        ];
        for (const name of orphanedState) {
            expect(
                dashboardSource,
                `dashboard still has orphaned state: ${name}`,
            ).not.toMatch(new RegExp(`\\b${name}\\b`));
        }
    });

    it("does not call the inline-editor APIs from the dashboard", () => {
        // Those endpoints are still used — but only from /profile/[id]/edit.
        expect(dashboardSource).not.toMatch(/\/api\/update-orgs/);
        expect(dashboardSource).not.toMatch(/\/api\/update-skills/);
        expect(dashboardSource).not.toMatch(/\/api\/x\/login/);
        expect(dashboardSource).not.toMatch(/\/api\/x\/disconnect/);
    });

    it("does not use alert() as an error UX", () => {
        // The moved editors replaced these with inline error states.
        expect(dashboardSource).not.toMatch(/\balert\(/);
    });

    it("is below the 500 LOC sanity ceiling", () => {
        const loc = dashboardSource.split("\n").length;
        expect(loc, `dashboard page is ${loc} LOC`).toBeLessThan(500);
    });
});

describe("dashboard hero block (post-PR5)", () => {
    it("links Edit Profile to /profile/[id]/edit, not the onboarding wizard", () => {
        // Catch a regression that would send the user back to /?edit=1 (the
        // old onboarding-wizard escape hatch).
        expect(heroSource).toMatch(/\/profile\/\$\{idValue\}\/edit/);
        expect(heroSource).not.toMatch(/\/\?edit=1&memberId=/);
    });

    it("exposes a Manage wallets link to /me/wallets", () => {
        expect(heroSource).toMatch(/\/me\/wallets/);
    });
});
