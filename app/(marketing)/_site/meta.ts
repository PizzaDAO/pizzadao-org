import type { Metadata } from "next";

/** Shared preview image until the home, about and partners pages get their own generated cards. */
const DEFAULT_IMAGE = "/marketing/assets/hero-crowd.jpg";

/**
 * Per-page metadata: title (the root layout adds " · PizzaDAO"), description, a canonical that
 * resolves against the site origin (so it follows the origin at cutover) and Open Graph / Twitter
 * tags. The robots tag comes from the marketing layout.
 */
export function pageMeta(o: { path: string; title: string; description: string; absoluteTitle?: boolean; image?: string }): Metadata {
  const fullTitle = o.absoluteTitle ? o.title : `${o.title} · PizzaDAO`;
  const image = o.image ?? DEFAULT_IMAGE;
  return {
    title: o.absoluteTitle ? { absolute: o.title } : o.title,
    description: o.description,
    alternates: { canonical: o.path },
    openGraph: {
      siteName: "PizzaDAO",
      type: "website",
      title: fullTitle,
      description: o.description,
      url: o.path,
      images: [{ url: image }],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: o.description, images: [image] },
  };
}
