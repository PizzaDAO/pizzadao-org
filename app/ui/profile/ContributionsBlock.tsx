"use client";

// app/ui/profile/ContributionsBlock.tsx
//
// Profile social-proof block — Plan: truffle-91035 (PR2 — pepperoni-77692).
// Articles (top 3 via shared ArticleCard) + Vouches (VouchesWidget,
// previously dashboard-only).
//
// Plan §4 promotes both above operational/collection data. Articles
// previously rendered inline (ignoring coverImage / tags / status). Now
// they reuse the shared ArticleCard component.

import { useArticlesByMember } from "../../lib/hooks/use-api";
import ArticleCard, { type ArticleCardData } from "../articles/ArticleCard";
import { VouchesWidget } from "../vouches/VouchesWidget";

interface ContributionsBlockProps {
    memberId: string;
}

type RawArticle = {
    slug: string;
    title: string;
    excerpt?: string | null;
    coverImage?: string | null;
    thumbnail?: string | null;
    tags?: string[] | null;
    authorId?: string;
    authorName?: string | null;
    status?: string;
    publishedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    id?: number;
};

export function ContributionsBlock({ memberId }: ContributionsBlockProps) {
    const { data: articlesData } = useArticlesByMember(memberId);
    const articles: RawArticle[] = articlesData?.articles ?? [];
    const top = articles.slice(0, 3);

    if (top.length === 0) {
        // Still show vouches block — the social proof tier — even when no articles.
        return (
            <section
                className="rounded-[--radius] border border-rule p-5 sm:p-6 shadow-sm"
                style={{
                    background: "hsl(var(--card))",
                    color: "hsl(var(--card-foreground))",
                }}
            >
                <VouchesWidget memberId={memberId} />
            </section>
        );
    }

    return (
        <section
            className="rounded-[--radius] border border-rule p-5 sm:p-6 shadow-sm grid gap-5"
            style={{
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
            }}
        >
            <div>
                <h3 className="mt-0 mb-3 font-display text-lg font-semibold text-foreground">
                    Articles
                </h3>
                <div
                    className="grid gap-3"
                    style={{
                        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    }}
                >
                    {top.map((a, i) => {
                        // Cast to the ArticleCard contract — by-member endpoint omits
                        // some fields, so backfill safe defaults.
                        const cardData: ArticleCardData = {
                            id: a.id ?? i,
                            slug: a.slug,
                            title: a.title,
                            excerpt: a.excerpt ?? null,
                            coverImage: a.coverImage ?? null,
                            thumbnail: a.thumbnail ?? null,
                            authorId: a.authorId ?? "",
                            authorName: a.authorName ?? null,
                            status: (a.status as ArticleCardData["status"]) ?? "PUBLISHED",
                            tags: Array.isArray(a.tags) ? a.tags : [],
                            publishedAt: a.publishedAt ?? null,
                            createdAt: a.createdAt ?? a.publishedAt ?? "",
                            updatedAt: a.updatedAt ?? a.publishedAt ?? "",
                        };
                        return <ArticleCard key={a.slug} article={cardData} />;
                    })}
                </div>
            </div>

            <div className="border-t border-rule pt-4">
                <VouchesWidget memberId={memberId} />
            </div>
        </section>
    );
}
