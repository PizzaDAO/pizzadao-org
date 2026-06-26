// app/profile/[id]/page.tsx
//
// Plan: truffle-91035 (PR3 — capricciosa-16483).
//
// Server-component wrapper. Its only job is to export generateMetadata so
// /profile/[id] renders rich OpenGraph + Twitter previews when shared into
// Discord / X / Telegram. All interactivity (React Query, ?as=visitor
// handling, owner banner, etc.) lives in <ProfileClient/>.

import type { Metadata } from "next";
import { composeProfileSummary } from "@/app/api/profile-summary/[id]/route";
import { ProfileClient } from "./ProfileClient";

export const runtime = "nodejs";

// Pull the same in-memory cache the API route uses by calling the composer
// directly. That avoids a self-HTTP round-trip during SSR and keeps the
// metadata path resilient to upstream sheet flakiness.
async function loadHero(id: string) {
    try {
        return await composeProfileSummary({ memberId: id, viewerMemberId: null });
    } catch {
        return null;
    }
}

function absoluteUrl(pathOrUrl: string | null): string | undefined {
    if (!pathOrUrl) return undefined;
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    const base =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (!base) return pathOrUrl; // relative path is fine for in-app browsers
    return `${base.replace(/\/$/, "")}${pathOrUrl}`;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ id: string }>;
}): Promise<Metadata> {
    const { id } = await params;
    const summary = await loadHero(id);

    if (!summary) {
        return {
            title: "Profile · PizzaDAO",
            description: "PizzaDAO member profile",
        };
    }

    const name = summary.hero.name || "PizzaDAO member";
    const tagline = summary.hero.tagline?.trim();
    const description = tagline || `${name} · PizzaDAO member`;
    const ogImage = absoluteUrl(summary.hero.pfpUrl);

    return {
        title: `${name} · PizzaDAO`,
        description,
        openGraph: {
            title: name,
            description,
            type: "profile",
            url: `/profile/${id}`,
            images: ogImage ? [{ url: ogImage, alt: `${name}'s profile picture` }] : undefined,
        },
        twitter: {
            card: "summary_large_image",
            title: name,
            description,
            images: ogImage ? [ogImage] : undefined,
        },
    };
}

export default async function ProfilePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <ProfileClient id={id} />;
}
