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
//
// onion-47612: editorial restyle — paper-soft card, "§ 04 · The work"
// overline, display-font subhead for the Articles sub-section. Logic and
// data shape unchanged.

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

const CARD_CLASS = "paper-soft halftone-soft relative rounded-[24px] border p-5 sm:p-6";
const CARD_STYLE: React.CSSProperties = {
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    borderColor: "hsl(var(--rule-warm) / 0.55)",
    boxShadow: "var(--shadow-soft, 0 8px 30px hsl(var(--ink) / 0.06))",
};

export function ContributionsBlock({ memberId }: ContributionsBlockProps) {
    const { data: articlesData } = useArticlesByMember(memberId);
    const articles: RawArticle[] = articlesData?.articles ?? [];
    const top = articles.slice(0, 3);

    if (top.length === 0) {
        // Still show vouches block — the social proof tier — even when no articles.
        return (
            <section className={CARD_CLASS} style={CARD_STYLE}>
                <p className="overline text-tomato mb-3">§ 04 · The work</p>
                <VouchesWidget memberId={memberId} />
            </section>
        );
    }

    return (
        <section className={`${CARD_CLASS} grid gap-5`} style={CARD_STYLE}>
            <p className="overline text-tomato">§ 04 · The work</p>

            <div>
                <h3
                    className="font-[family-name:var(--font-display)] m-0 mb-3 font-bold tracking-[-0.01em] text-foreground"
                    style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.35rem)" }}
                >
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

            <div className="rule pt-4">
                <VouchesWidget memberId={memberId} />
            </div>
        </section>
    );
}
