"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Story = { slug: string; title: string; excerpt?: string | null };
const PHOTOS = [
  { city: "Amsterdam", src: "/media/community-amsterdam.jpg" },
  { city: "Melbourne", src: "/media/community-melbourne.jpg" },
  { city: "Quito", src: "/media/community-quito.jpg" },
];

export function CommunityPreview() {
  const t = useTranslations("onboarding.community");
  const [stories, setStories] = useState<Story[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/articles?limit=3", { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (Array.isArray(data?.articles)) setStories(data.articles.slice(0, 3)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-10 border-t border-[hsl(var(--rule-warm)/0.55)] pt-10 text-left">
      <section aria-labelledby="community-heading">
        <p className="overline text-tomato-readable">{t("overline")}</p>
        <h2 id="community-heading" className="mt-2 font-display text-3xl font-bold text-foreground">{t("heading")}</h2>
        <p className="mt-3 text-base leading-relaxed text-foreground/80">{t("description")}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {PHOTOS.map(photo => <figure key={photo.city} className="m-0 overflow-hidden rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] bg-card">
            <div className="relative aspect-[4/3]"><Image src={photo.src} alt={t("photoAlt", { city: photo.city })} fill sizes="(max-width: 639px) calc(100vw - 32px), 190px" className="object-cover" /></div>
            <figcaption className="px-3 py-3 text-sm font-semibold text-foreground">{photo.city}<span className="mt-1 block text-sm font-normal text-foreground/75">{t("photoCaption")}</span></figcaption>
          </figure>)}
        </div>
      </section>
      <section aria-labelledby="participation-heading">
        <h2 id="participation-heading" className="font-display text-2xl font-bold">{t("participate")}</h2>
        <div className="mt-4 grid gap-3">
          {[{key:"local",href:"/join"},{key:"crews",href:"/crews"},{key:"projects",href:"/tech/projects"}].map(item => <Link key={item.key} href={item.href} className="rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] bg-card px-5 py-4 text-foreground no-underline hover:border-tomato-readable focus-visible:outline-2 focus-visible:outline-tomato-readable"><span className="block font-semibold">{t(`${item.key}Title`)} ↗</span><span className="mt-1 block text-sm leading-relaxed text-foreground/80">{t(`${item.key}Description`)}</span></Link>)}
        </div>
      </section>
      <section aria-labelledby="stories-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="stories-heading" className="font-display text-2xl font-bold">{t("stories")}</h2><Link href="/articles" className="inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">{t("allStories")}</Link></div>
        {stories.length > 0 && <ul className="m-0 mt-3 grid list-none gap-3 p-0">{stories.map(story => <li key={story.slug}><Link href={`/articles/${encodeURIComponent(story.slug)}`} className="block min-h-11 rounded-xl bg-card px-4 py-3 font-semibold text-foreground no-underline hover:text-tomato-readable">{story.title}{story.excerpt && <span className="mt-1 block line-clamp-2 text-sm font-normal text-foreground/80">{story.excerpt}</span>}</Link></li>)}</ul>}
      </section>
    </div>
  );
}
