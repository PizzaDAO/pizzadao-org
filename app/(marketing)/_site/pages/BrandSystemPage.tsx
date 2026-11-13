"use client";

import {  } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/app/(marketing)/_site/components/ui/tabs";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import SectionNav from "@/app/(marketing)/_site/components/SectionNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import CopyToken, { hexToRgb, cssVarName } from "@/app/(marketing)/_site/components/CopyToken";
import UseInFigma from "@/app/(marketing)/_site/components/UseInFigma";
import DoDont from "@/app/(marketing)/_site/components/DoDont";
import { ArrowUpRight, Download, Github, FileCode2, Terminal, Sparkles } from "lucide-react";
import { track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";
import { useTrackOutbound } from "@/app/(marketing)/_site/lib/analytics/useTrackOutbound";

const moltoBenny = "/marketing/assets/brand/molto-benny-color.png";
const moltoBennyPrintRun = "/marketing/assets/brand/molto-benny-print-run.jpg";
const wildPoster = "/marketing/assets/wild-poster.jpg";
const wildMerch = "/marketing/assets/wild-merch.jpg";
const wildTaxi = "/marketing/assets/wild-taxi.jpg";
const wildEvent = "/marketing/assets/wild-event.jpg";
const wildProjection = "/marketing/assets/brand/wild/projection-mafia.jpg";
const wildBoxes = "/marketing/assets/brand/wild/pizza-boxes.jpg";
const wildTee = "/marketing/assets/brand/wild/bazaar-tee.jpg";
const wildArrow = "/marketing/assets/brand/wild/free-pizza-arrow.png";
const wildBitcoin = "/marketing/assets/brand/wild/ten-thousand-bitcoin.jpg";
const logoBlack = "/marketing/assets/brand/pizzadao-logo-black.svg";
const logoWhite = "/marketing/assets/brand/pizzadao-logo-white.svg";
const iconBlack = "/marketing/assets/brand/pizzadao-icon-black.svg";
const flyerPizzaFuture = "/marketing/assets/brand/flyers/pizza-future.jpg";
const flyerDaoTokyo = "/marketing/assets/brand/flyers/dao-tokyo.jpg";
const flyerPizzaFesta = "/marketing/assets/brand/flyers/pizzafesta.jpg";
const SECTIONS = [
  { code: "B.01", title: "Logo & marks", desc: "Primary lockup, monogram, and approved variations." },
  { code: "B.02", title: "Color system", desc: "Sauce, Cheese, Flour, Char, primary palette plus an extended pantry of accents." },
  { code: "B.03", title: "Typography", desc: "Asap Condensed for display, Asap for body. Editorial rhythm." },
  { code: "B.04", title: "Voice & tone", desc: "How PizzaDAO writes. Sentence case, plain words, sharp wit." },
  { code: "B.07", title: "Brand.md", desc: "A machine-readable brand spec for builders and agents." },
  { code: "B.11", title: "How we sound", desc: "Tone scales, headlines we'd ship, CTAs we wouldn't." },
  { code: "B.08", title: "MCP server", desc: "Programmatic access to brand assets via Model Context Protocol." },
];

const BrandSystemPage = () => {
  const trackOutbound = useTrackOutbound("brand_system");


  return (
    <div className="min-h-screen bg-cream text-ink lg:pl-[180px]">
      <SiteNav solid />

      <SectionNav />

      {/* § B, Hero */}
      <section id="overview" className="mk-paper-soft paper-drift relative overflow-hidden bg-cream pt-28 md:pt-36">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">Doc · v1.0 · Public asset</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-10">
              <div className="col-span-12 md:col-span-8">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B, Brand System</p><span className="mk-handwritten -rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">open source energy</span></div>
                <h1 className="font-display mt-5 text-mega font-extrabold leading-[0.86]">
                  Build with
                  <br />
                  <span className="text-tomato">PizzaDAO.</span>
                </h1>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-8">
                <p className="text-lg leading-relaxed text-ink/80 md:text-xl max-w-[60ch]">
                  Everything you need to use, remix, and extend the PizzaDAO brand. Open files, open spec, open invitation.
                </p>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-3 pt-8 md:mt-14 md:pt-10">
              <a
                href="https://pizzadao.github.io/pizzadao-brand-kit/"
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  track(EVT.BRAND_ASSET_DOWNLOADED, { asset: "brand-kit", surface: "hero" });
                  trackOutbound("Download assets", "https://pizzadao.github.io/pizzadao-brand-kit/", { surface: "hero" });
                }}
                className="mk-btn-pill-lg bg-ink text-cream hover:bg-tomato"
              >
                <Download className="h-4 w-4" />
                Download assets
              </a>
              <a
                href="https://github.com/pizzadao"
                target="_blank"
                rel="noreferrer"
                onClick={() => trackOutbound("GitHub", "https://github.com/pizzadao", { surface: "hero" })}
                className="mk-btn-pill-lg border border-ink/20 bg-cream text-ink hover:border-ink hover:bg-butter"
              >
                <Github className="h-4 w-4" />
                View GitHub
              </a>

              <a
                href="#brand-md"
                className="mk-btn-pill-lg border border-ink/20 bg-cream text-ink hover:border-ink hover:bg-butter"
              >
                <FileCode2 className="h-4 w-4" />
                Open Brand.md
              </a>
              <span className="ui ml-auto hidden text-[11px] uppercase tracking-[0.2em] text-ink/55 md:block">
                v0.1 · Open license · Built in public
              </span>
            </div>

            {/* Live ticker, community contributions */}
            <div className="mt-10 rounded-2xl border border-ink/10 bg-cream/60 px-4 py-3 backdrop-blur-sm md:mt-14 md:px-5 md:py-3.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="ui inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                  <span aria-hidden className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-tomato/60" />
                    <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-tomato" />
                  </span>
                  Live · in the system
                </span>
                <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink/65 md:text-[12px]">
                  {[
                    { tag: "New", label: "Benny variation · São Paulo" },
                    { tag: "Remix", label: "Latest chapter poster · Lagos" },
                    { tag: "Updated", label: "Sticker pairing · v1.2" },
                    { tag: "Print", label: "Community example · Berlin" },
                  ].map((u) => (
                    <li key={u.label} className="inline-flex items-center gap-1.5">
                      <span className="ui rounded-full border border-ink/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/55">{u.tag}</span>
                      <span className="truncate">{u.label}</span>
                    </li>
                  ))}
                </ul>
                <a href="https://github.com/pizzadao" target="_blank" rel="noreferrer" className="ui inline-flex items-center gap-1 text-[11px] font-semibold text-ink/70 underline-offset-4 hover:text-tomato hover:underline">
                  See changelog <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* § B, Quick start */}
      <section aria-labelledby="quick-start" className="mk-print-noise relative overflow-hidden bg-cream pt-12 md:pt-16">
        <div className="container">
          <div className="rounded-3xl bg-ink p-6 text-cream shadow-sm md:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato">
                  § B, Quick start
                </p>
                <h2 id="quick-start" className="font-display mt-2 text-2xl font-extrabold leading-[1.05] md:text-3xl">
                  Five rules. Start shipping.
                </h2>
              </div>
              <a
                href="#principles"
                className="ui inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-cream ring-1 ring-inset ring-cream/30 transition-colors hover:bg-cream hover:text-ink"
              >
                Read the full system →
              </a>
            </div>

            <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
              {[
                { n: "01", t: "Lead with one color", d: "Sauce or Cheese, never both at once." },
                { n: "02", t: "Set type in sentence case", d: "All caps only for tiny labels." },
                { n: "03", t: "Cream is the page", d: "White is for screens, not surfaces." },
                { n: "04", t: "Show real moments", d: "Slices, sidewalks, faces. No stock." },
                { n: "05", t: "Let the work breathe", d: "Whitespace is part of the brand." },
              ].map((s) => (
                <li
                  key={s.n}
                  className="flex flex-col gap-2 rounded-2xl bg-cream/5 p-4 ring-1 ring-inset ring-cream/10"
                >
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">
                    {s.n}
                  </span>
                  <p className="font-display text-base font-bold leading-tight text-cream">
                    {s.t}.
                  </p>
                  <p className="text-[12.5px] leading-snug text-cream/70">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>


      {/* § B.0, Principles */}
      <section id="principles" className="mk-halftone-soft relative overflow-hidden bg-[hsl(var(--ink)/0.035)] py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-5 top-4 z-10 hidden md:block"><span className="mk-handwritten rotate-[2deg] text-ink/40 text-xs md:text-sm leading-none">field notes · 2025</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.0, Principles</p><span className="mk-handwritten rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">community first</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  How the brand behaves.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Four rules of thumb. Pin them above the desk, then forget the rest.
                </p>
              </div>
            </div>

            <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                { n: "01", t: "Use bold color with restraint", d: "Two ingredients lead. A third only if it earns its place." },
                { n: "02", t: "Let content lead, brand supports", d: "The work is the hero. The system holds the frame." },
                { n: "03", t: "Keep layouts simple and legible", d: "Editorial rhythm beats decoration. Whitespace is a feature." },
                { n: "04", t: "Favor real moments over polish", d: "Chapters, slices, sidewalks. Always preferred to studio gloss." },
              ].map((p) => (
                <li key={p.n} className="flex flex-col bg-cream p-5 md:p-7">
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">{p.n}</span>
                  <h3 className="font-display mt-6 text-2xl font-extrabold leading-[1.02] md:text-3xl">{p.t}.</h3>
                  <p className="mt-4 text-sm leading-relaxed text-ink/70 max-w-[60ch]">{p.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>


      {/* § B.01, Logos */}
      <section id="logos" className="mk-paper-soft paper-drift relative overflow-hidden bg-cream py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">Asset pack · v1.0</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            {/* Masthead */}
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.01, Logos</p><span className="mk-handwritten -rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">remix encouraged</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  The marks, on the right surface.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Three marks, one rule: pick the one that reads cleanest on the surface you're putting it on. SVG only, these are vector, infinitely sharp, and the only format we ship.
                </p>
              </div>
            </div>

            {/* Logo grid */}
            <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm lg:grid-cols-3">
              {/* Dark logo on light */}
              <article className="flex flex-col bg-cream">
                <div className="flex aspect-[4/3] items-center justify-center bg-cream p-10 ring-1 ring-inset ring-ink/10">
                  <img
                    src={logoBlack}
                    alt="PizzaDAO dark logo on cream background"
                    className="max-h-24 w-auto max-w-[80%]"
                    loading="lazy"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5 md:p-7">
                  <div className="flex items-start justify-between gap-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">L.01 · Dark</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">SVG</span>
                  </div>
                  <h3 className="font-display text-3xl font-extrabold leading-[0.95]">
                    Dark logo
                  </h3>
                  <p className="text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                    For light backgrounds. Default mark on cream, white, and any pale photography.
                  </p>
                  <a
                    href={logoBlack}
                    download="pizzadao-logo-black.svg"
                    className="ui mt-auto inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-cream transition-colors hover:bg-tomato"
                  >
                    <Download className="h-4 w-4" />
                    Download SVG
                  </a>
                </div>
              </article>

              {/* Light logo on dark */}
              <article className="flex flex-col bg-cream">
                <div className="flex aspect-[4/3] items-center justify-center bg-ink p-10">
                  <img
                    src={logoWhite}
                    alt="PizzaDAO light logo on ink background"
                    className="max-h-24 w-auto max-w-[80%]"
                    loading="lazy"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5 md:p-7">
                  <div className="flex items-start justify-between gap-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">L.02 · Light</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">SVG</span>
                  </div>
                  <h3 className="font-display text-3xl font-extrabold leading-[0.95]">
                    Light logo
                  </h3>
                  <p className="text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                    For dark backgrounds. Use on ink, deep imagery, and night-mode surfaces.
                  </p>
                  <a
                    href={logoWhite}
                    download="pizzadao-logo-white.svg"
                    className="ui mt-auto inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-cream transition-colors hover:bg-tomato"
                  >
                    <Download className="h-4 w-4" />
                    Download SVG
                  </a>
                </div>
              </article>

              {/* Icon */}
              <article className="flex flex-col bg-cream">
                <div className="flex aspect-[4/3] items-center justify-center bg-butter p-10">
                  <img
                    src={iconBlack}
                    alt="PizzaDAO icon mark on butter background"
                    className="max-h-24 w-auto"
                    loading="lazy"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5 md:p-7">
                  <div className="flex items-start justify-between gap-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">L.03 · Icon</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">SVG</span>
                  </div>
                  <h3 className="font-display text-3xl font-extrabold leading-[0.95]">
                    Icon
                  </h3>
                  <p className="text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                    Standalone mark for avatars, favicons, app icons, and tight social crops.
                  </p>
                  <a
                    href={iconBlack}
                    download="pizzadao-icon-black.svg"
                    className="ui mt-auto inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-cream transition-colors hover:bg-tomato"
                  >
                    <Download className="h-4 w-4" />
                    Download SVG
                  </a>
                </div>
              </article>
            </div>

            {/* Real-world usage, context */}
            <div className="mt-16">
              <div className="flex items-end justify-between gap-6 pt-6">
                <p className="mk-overline text-tomato">L.04, In context</p>
                <span className="ui hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55 md:block">
                  Where the marks live
                </span>
              </div>
              <div className="mt-6 grid grid-cols-12 gap-3 md:gap-4">
                <figure className="col-span-12 overflow-hidden rounded-2xl border border-ink/15 bg-ink sm:col-span-6 lg:col-span-3">
                  <div className="relative aspect-[4/5]">
                    <img src={wildPoster} alt="PizzaDAO dark logo on a wheatpasted street poster" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                  <figcaption className="flex items-center justify-between gap-3 border-t border-cream/15 bg-ink px-4 py-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-cream">Posters</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/55">Dark logo · paste-up</span>
                  </figcaption>
                </figure>
                <figure className="col-span-12 overflow-hidden rounded-2xl border border-ink/15 bg-ink sm:col-span-6 lg:col-span-3">
                  <div className="relative aspect-[4/5]">
                    <img src={wildMerch} alt="PizzaDAO icon on merchandise, t-shirt and stickers" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                  <figcaption className="flex items-center justify-between gap-3 border-t border-cream/15 bg-ink px-4 py-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-cream">Merch</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/55">Icon · embroidered + print</span>
                  </figcaption>
                </figure>
                <figure className="col-span-12 overflow-hidden rounded-2xl border border-ink/15 bg-ink sm:col-span-6 lg:col-span-3">
                  <div className="relative aspect-[4/5]">
                    <img src={wildEvent} alt="PizzaDAO light logo at a community party" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                  <figcaption className="flex items-center justify-between gap-3 border-t border-cream/15 bg-ink px-4 py-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-cream">Events</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/55">Light logo · stage + signage</span>
                  </figcaption>
                </figure>
                <figure className="col-span-12 overflow-hidden rounded-2xl border border-ink/15 bg-ink sm:col-span-6 lg:col-span-3">
                  <div className="relative aspect-[4/5]">
                    <img src={wildTaxi} alt="PizzaDAO slice-shaped delivery car topper mounted on a car roof in Brooklyn" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                  <figcaption className="flex items-center justify-between gap-3 border-t border-cream/15 bg-ink px-4 py-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-cream">Out in the Wild</span>
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/55">Delivery car topper · street object</span>
                  </figcaption>
                </figure>
              </div>
            </div>

            {/* Source note */}
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 pt-6">
              <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">
                Source · pizzadao.github.io/pizzadao-brand-kit
              </p>
              <a
                href="https://pizzadao.github.io/pizzadao-brand-kit/"
                target="_blank"
                rel="noopener noreferrer"
                className="ui inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink hover:text-tomato"
              >
                View full brand kit <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* § B.01, Index of the kit */}
      <section id="downloads" className="mk-print-noise relative overflow-hidden bg-[hsl(var(--ink)/0.035)] py-16 md:py-24">
        <div aria-hidden className="pointer-events-none absolute right-5 top-4 z-10 hidden md:block"><span className="mk-handwritten rotate-[2deg] text-ink/40 text-xs md:text-sm leading-none">open license</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <p className="mk-overline text-tomato">§ B.01, Index</p>
                <h2 className="font-display mt-5 text-4xl font-extrabold leading-[0.92] md:text-6xl">
                  What's inside the kit.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Each module ships as a standalone reference. Pull only what you need.
                </p>
              </div>
            </div>

            <ul className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-ink/15 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {SECTIONS.map((s) => (
                <li key={s.code} className="group bg-cream p-6 transition-colors hover:bg-butter md:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">
                      {s.code}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-ink/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
                  </div>
                  <h3 className="font-display mt-6 text-2xl font-extrabold leading-[0.95] md:text-3xl">
                    {s.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink/70 max-w-[60ch]">{s.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* § B.02, Typography */}
      <section id="typography" className="mk-halftone-soft relative overflow-hidden bg-cream py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">Type spec · Public</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            {/* Masthead */}
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.02, Typography</p><span className="mk-handwritten rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">set it loud, set it kind</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  A voice you can set in type.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <div className="mb-4 flex md:justify-end">
                  <UseInFigma href="https://www.figma.com/community/search?q=asap%20solway" label="Use this type" />
                </div>
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]" style={{ fontFamily: "'Solway', Georgia, serif" }}>
                  Two families. One for impact, one for the slow read. Asap carries the headlines and the interface. Solway warms up the long-form, editorial weight, generous body.
                </p>
              </div>
            </div>

            {/* Family cards */}
            <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm md:grid-cols-2">
              {/* Asap */}
              <article className="bg-cream p-5 md:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">T.01, Primary</span>
                    <h3 className="font-display mt-3 text-6xl font-extrabold leading-none md:text-7xl">Asap</h3>
                  </div>
                  <a
                    href="https://fonts.google.com/specimen/Asap"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui inline-flex items-center gap-1.5 rounded-full border border-ink/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink transition-colors hover:bg-ink hover:text-cream"
                  >
                    Google Fonts <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                  Display, headlines, UI, buttons, captions. Condensed cut for impact, regular for interface.
                </p>
                <div className="mt-8 space-y-5 pt-6">
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="font-display text-3xl font-normal text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">400 · Regular</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="font-display text-3xl font-semibold text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">600 · Semibold</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="font-display text-3xl font-bold text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">700 · Bold</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-display text-3xl font-extrabold text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">800 · Extrabold</span>
                  </div>
                </div>
              </article>

              {/* Solway */}
              <article className="bg-cream p-5 md:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">T.02, Secondary</span>
                    <h3 className="mt-3 text-6xl font-bold leading-none md:text-7xl" style={{ fontFamily: "'Solway', Georgia, serif" }}>
                      Solway
                    </h3>
                  </div>
                  <a
                    href="https://fonts.google.com/specimen/Solway"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui inline-flex items-center gap-1.5 rounded-full border border-ink/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink transition-colors hover:bg-ink hover:text-cream"
                  >
                    Google Fonts <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                  Editorial subheads, long-form body, pull quotes. Use sparingly to slow the eye where it matters.
                </p>
                <div className="mt-8 space-y-5 pt-6" style={{ fontFamily: "'Solway', Georgia, serif" }}>
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="text-3xl font-light text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">300 · Light</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="text-3xl font-normal text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">400 · Regular</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-b border-ink/8 pb-3">
                    <span className="text-3xl font-medium text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">500 · Medium</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-3xl font-bold text-ink">Aa Bb Cc 123</span>
                    <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/50">700 · Bold</span>
                  </div>
                </div>
              </article>
            </div>

            {/* Hierarchy specimen */}
            <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-12">
              <div className="col-span-12 md:col-span-8">
                <p className="mk-overline text-tomato">T.03, Hierarchy in motion</p>

                <div className="mt-8 pt-8">
                  <span className="ui block text-[10px] uppercase tracking-[0.2em] text-ink/45">H1 · Asap Condensed Extrabold · clamp 56–112</span>
                  <h1 className="font-display mt-3 text-[clamp(3.5rem,9vw,7rem)] font-extrabold leading-[0.88] text-ink">
                    Pizza the planet.
                  </h1>
                </div>

                <div className="mt-12 pt-8">
                  <span className="ui block text-[10px] uppercase tracking-[0.2em] text-ink/45">H2 · Asap Condensed Extrabold · clamp 36–64</span>
                  <h2 className="font-display mt-3 text-[clamp(2.25rem,5vw,4rem)] font-extrabold leading-[0.95] text-ink">
                    A neighborhood is a network.
                  </h2>
                </div>

                <div className="mt-12 pt-8">
                  <span className="ui block text-[10px] uppercase tracking-[0.2em] text-ink/45">Subhead · Solway Medium · 22/30</span>
                  <p className="mt-3 text-[22px] leading-[1.35] text-ink" style={{ fontFamily: "'Solway', Georgia, serif", fontWeight: 500 }}>
                    Five years of building unforgettable moments with people who show up for their block, their city, their slice.
                  </p>
                </div>

                <div className="mt-12 pt-8">
                  <span className="ui block text-[10px] uppercase tracking-[0.2em] text-ink/45">Body · Solway Regular · 17/1.6</span>
                  <p className="mt-3 max-w-[58ch] text-[17px] leading-[1.6] text-ink/85" style={{ fontFamily: "'Solway', Georgia, serif" }}>
                    PizzaDAO is a global community using pizza, art, and internet culture to support local businesses and bring people together. We host the largest pizza party on Earth, every year, in seventy-five-plus cities, on six continents, and we publish what we learn so other neighborhoods can do the same.
                  </p>
                </div>

                <div className="mt-12 pt-8">
                  <span className="ui block text-[10px] uppercase tracking-[0.2em] text-ink/45">Caption / UI · Asap Semibold · 11 · tracked</span>
                  <p className="ui mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
                    Fig. 03, Specimen, set live in the page · Updated continuously
                  </p>
                </div>
              </div>

              {/* Mixed usage editorial card */}
              <aside className="col-span-12 md:col-span-4">
                <p className="mk-overline text-tomato">T.04, Mixed usage</p>
                <figure className="mt-8 overflow-hidden rounded-3xl bg-butter shadow-sm p-5 md:p-7">
                  <span className="ui text-[10px] uppercase tracking-[0.2em] text-ink/55">Editorial card · in the wild</span>
                  <h3 className="font-display mt-4 text-5xl font-extrabold leading-[0.9] text-ink md:text-6xl">
                    Hot, cheap,<br />and yours.
                  </h3>
                  <p className="mt-5 text-[16px] leading-[1.55] text-ink/85" style={{ fontFamily: "'Solway', Georgia, serif" }}>
                    A slice from the corner spot, a folding chair, a stranger you'll know by the end of the night. That's the whole pitch.
                  </p>
                  <figcaption className="ui mt-6 flex items-center gap-2 border-t border-ink/20 pt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/65">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-tomato" />
                    Asap headline · Solway body
                  </figcaption>
                </figure>

                <div className="mt-6 rounded-3xl bg-ink shadow-sm p-8 text-cream md:p-10">
                  <span className="ui text-[10px] uppercase tracking-[0.2em] text-cream/55">Quick reference</span>
                  <ul className="mt-5 space-y-3 text-sm">
                    <li className="flex items-baseline justify-between gap-4 border-b border-cream/15 pb-3">
                      <span className="font-display font-semibold">Headlines</span>
                      <span className="ui text-cream/65">Asap Condensed</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-4 border-b border-cream/15 pb-3">
                      <span className="font-display font-semibold">UI · Buttons</span>
                      <span className="ui text-cream/65">Asap</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-4 border-b border-cream/15 pb-3">
                      <span style={{ fontFamily: "'Solway', Georgia, serif" }} className="font-medium">Subheads</span>
                      <span className="ui text-cream/65">Solway 500</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-4">
                      <span style={{ fontFamily: "'Solway', Georgia, serif" }}>Long-form body</span>
                      <span className="ui text-cream/65">Solway 400</span>
                    </li>
                  </ul>
                </div>
              </aside>
            </div>

            {/* Typography Do / Don't */}
            <DoDont
              doExample={
                <div className="w-full max-w-[280px]">
                  <p className="font-display text-3xl font-extrabold leading-[0.95] text-ink">Block party.</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink/70">Sentence case headlines, generous leading.</p>
                </div>
              }
              dontExample={
                <div className="w-full max-w-[280px]">
                  <p className="font-display text-3xl font-extrabold leading-[0.95] text-ink" style={{ textTransform: "uppercase" }}>BLOCK PARTY.</p>
                  <p className="mt-2 text-sm leading-tight text-ink/70" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>SENTENCE CASE HEADLINES.</p>
                </div>
              }
              note="Set headlines and body in sentence case. All caps is reserved for tiny editorial labels (≤11px), never running text."
            />

          </div>
        </div>
      </section>

      {/* § B.03, Color */}
      <section id="color" className="mk-paper-soft paper-drift relative overflow-hidden bg-[hsl(var(--ink)/0.035)] py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">Color tokens · v1.0</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            {/* Masthead */}
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.03, Color</p><span className="mk-handwritten -rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">hot & ready</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Four ingredients lead. The rest season.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <div className="mb-4 flex md:justify-end">
                  <UseInFigma href="https://www.figma.com/community/file/pizzadao-color-tokens" label="Open color tokens" />
                </div>
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Sauce, Cheese, Flour, Char. The whole brand is cooked from these four. Everything else in the pantry is a finishing touch, used on purpose, never as filler.
                </p>
              </div>
            </div>

            {/* Primary palette label */}
            <div className="mt-12 flex items-end justify-between gap-6 pb-4">
              <div>
                <span className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">C.00</span>
                <p className="font-display mt-1 text-2xl font-extrabold leading-none text-ink md:text-3xl">Primary palette</p>
              </div>
              <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/55">04 / core</span>
            </div>

            {/* Primary swatches, the four */}
            <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {/* Sauce */}
              <article className="flex flex-col bg-cream">
                <div className="aspect-[4/5] bg-tomato p-5 md:p-7">
                  <div className="flex h-full flex-col justify-between">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-cream/85">C.01 · Signal</span>
                    <div>
                      <span className="font-display block text-5xl font-extrabold leading-none text-cream md:text-6xl">Sauce</span>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <CopyToken label="HEX" value="#F83A3A" tone="dark" />
                        <CopyToken label="RGB" value={hexToRgb("#F83A3A")} tone="dark" />
                        <CopyToken label="VAR" value="--color-sauce" tone="dark" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5 md:p-7">
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">Used for</span>
                  <p className="text-sm leading-relaxed text-ink/80">
                    The brand voice out loud. Hero bands, primary CTAs, eyebrows, hover states, anywhere the page needs to raise its hand.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Hero</span>
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">CTA</span>
                  </div>
                </div>
              </article>

              {/* Cheese, yellow */}
              <article className="relative flex flex-col bg-cream">
                <span aria-hidden className="mk-handwritten pointer-events-none absolute -top-5 right-2 z-10 -rotate-[3deg] text-[13px] leading-none text-ink/45 md:-top-6 md:right-3 md:text-sm">too much yellow gets chaotic</span>
                <div className="aspect-[4/5] bg-butter p-5 md:p-7">
                  <div className="flex h-full flex-col justify-between">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/65">C.02 · Highlight</span>
                    <div>
                      <span className="font-display block text-5xl font-extrabold leading-none text-ink md:text-6xl">Cheese</span>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <CopyToken label="HEX" value="#FFD23F" tone="light" />
                        <CopyToken label="RGB" value={hexToRgb("#FFD23F")} tone="light" />
                        <CopyToken label="VAR" value="--color-cheese" tone="light" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5 md:p-7">
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">Used for</span>
                  <p className="text-sm leading-relaxed text-ink/80">
                    Highlight bands, community sections, Real Rooms, energy moments. The warmth that breaks the page open, used intentionally, never constantly.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Highlight</span>
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Community</span>
                  </div>
                </div>
              </article>

              {/* Flour */}
              <article className="flex flex-col bg-cream">
                <div className="aspect-[4/5] bg-cream p-6 ring-1 ring-inset ring-ink/10 md:p-8">
                  <div className="flex h-full flex-col justify-between">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">C.03 · Surface</span>
                    <div>
                      <span className="font-display block text-5xl font-extrabold leading-none text-ink md:text-6xl">Flour</span>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <CopyToken label="HEX" value="#FBF7EC" tone="light" />
                        <CopyToken label="RGB" value={hexToRgb("#FBF7EC")} tone="light" />
                        <CopyToken label="VAR" value="--color-flour" tone="light" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5 md:p-7">
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">Used for</span>
                  <p className="text-sm leading-relaxed text-ink/80">
                    The default page surface. Soft, warm, slightly off-white, the paper everything else sits on. Clean layouts start here.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Background</span>
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Editorial</span>
                  </div>
                </div>
              </article>

              {/* Char */}
              <article className="flex flex-col bg-cream">
                <div className="aspect-[4/5] bg-ink p-5 md:p-7">
                  <div className="flex h-full flex-col justify-between">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-cream/55">C.04 · Structure</span>
                    <div>
                      <span className="font-display block text-5xl font-extrabold leading-none text-cream md:text-6xl">Char</span>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <CopyToken label="HEX" value="#0A0A0A" tone="dark" />
                        <CopyToken label="RGB" value={hexToRgb("#0A0A0A")} tone="dark" />
                        <CopyToken label="VAR" value="--color-char" tone="dark" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5 md:p-7">
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">Used for</span>
                  <p className="text-sm leading-relaxed text-ink/80">
                    All body and headline text on light surfaces, dark editorial sections, primary buttons, rules and dividers. The structural color.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Text</span>
                    <span className="ui rounded-full border border-ink/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/65">Contrast</span>
                  </div>
                </div>
              </article>
            </div>

            {/* Extended palette */}
            <div className="mt-20">
              <div className="grid grid-cols-12 items-end gap-x-6 gap-y-4 pb-4">
                <div className="col-span-12 md:col-span-7">
                  <span className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">C.05</span>
                  <p className="font-display mt-1 text-2xl font-extrabold leading-none text-ink md:text-3xl">Extended palette</p>
                </div>
                <div className="col-span-12 md:col-span-5 md:pb-1">
                  <p className="text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                    A wider pantry for illustration, accents, and one-off moments. Never the structure of a layout, always the seasoning.
                  </p>
                </div>
              </div>

              <ul className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm md:grid-cols-3 lg:grid-cols-6">
                {[
                  { code: "E.01", name: "Apron", hex: "#2F5DAA", note: "Accent · illustration", textOnDark: true },
                  { code: "E.02", name: "Basil", hex: "#3B7A3F", note: "Accent · illustration", textOnDark: true },
                  { code: "E.03", name: "Fig", hex: "#6B3A78", note: "Accent · illustration", textOnDark: true },
                  { code: "E.04", name: "Sea Glass", hex: "#7FC9C0", note: "Highlight · illustration", textOnDark: false },
                  { code: "E.05", name: "Prosciutto", hex: "#F2B5B5", note: "Highlight · illustration", textOnDark: false },
                  { code: "E.06", name: "Wood Fire", hex: "#6B3A22", note: "Accent · optional", textOnDark: true },
                ].map((c) => (
                  <li key={c.name} className="flex flex-col bg-cream">
                    <div
                      className="aspect-[4/5] p-5 md:p-6"
                      style={{ backgroundColor: c.hex }}
                    >
                      <div className="flex h-full flex-col justify-between">
                        <span
                          className="ui text-[10px] font-semibold uppercase tracking-[0.2em]"
                          style={{ color: c.textOnDark ? "rgba(251,247,236,0.85)" : "rgba(10,10,10,0.6)" }}
                        >
                          {c.code}
                        </span>
                        <div>
                          <span
                            className="font-display block text-2xl font-extrabold leading-none md:text-3xl"
                            style={{ color: c.textOnDark ? "#FBF7EC" : "#0A0A0A" }}
                          >
                            {c.name}
                          </span>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <CopyToken label="HEX" value={c.hex} tone={c.textOnDark ? "dark" : "light"} />
                            <CopyToken label="VAR" value={cssVarName(c.name)} tone={c.textOnDark ? "dark" : "light"} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-4 md:p-5">
                      <span className="ui text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/45">Use as</span>
                      <p className="text-[13px] leading-snug text-ink/75">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-baseline justify-between gap-6">
                <p className="text-xs leading-relaxed text-ink/55 max-w-[60ch]">
                  Extended colors never carry a layout on their own. Pair them with Flour or Char, and keep them to a single moment per page.
                </p>
                <span aria-hidden className="mk-handwritten hidden shrink-0 rotate-[2deg] text-sm leading-none text-ink/45 md:inline-block">seasoning, not the meal</span>
              </div>
            </div>

            {/* Supporting opacities */}
            <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-4">
                <p className="mk-overline text-tomato">C.07, Supporting</p>
                <h3 className="font-display mt-4 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                  The opacities that do the quiet work.
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                  No extra grays in the pantry. Hairlines, secondary text, and soft fills are derived from Char and Flour at fixed opacities, keeps the system honest.
                </p>
              </div>
              <div className="col-span-12 md:col-span-8">
                <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink/15 shadow-sm sm:grid-cols-3">
                  {[
                    { name: "Char 85", note: "Body text", swatch: "bg-ink", opacity: 0.85, onDark: false },
                    { name: "Char 70", note: "Secondary copy", swatch: "bg-ink", opacity: 0.7, onDark: false },
                    { name: "Char 15", note: "Hairline rules", swatch: "bg-ink", opacity: 0.15, onDark: false },
                    { name: "Flour 75", note: "Body on dark", swatch: "bg-cream", opacity: 0.75, onDark: true },
                    { name: "Flour 55", note: "Captions on dark", swatch: "bg-cream", opacity: 0.55, onDark: true },
                    { name: "Flour 15", note: "Rules on dark", swatch: "bg-cream", opacity: 0.15, onDark: true },
                  ].map((n) => (
                    <li key={n.name} className={`flex flex-col gap-3 p-5 ${n.onDark ? "bg-ink" : "bg-cream"}`}>
                      <div
                        className={`h-10 w-full rounded-md ${n.swatch}`}
                        style={{ opacity: n.opacity }}
                      />
                      <div>
                        <span className={`font-display block text-lg font-semibold ${n.onDark ? "text-cream" : "text-ink"}`}>
                          {n.name}
                        </span>
                        <span className={`ui mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] ${n.onDark ? "text-cream/55" : "text-ink/55"}`}>
                          {n.note}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Pairings, the system in motion */}
            <div className="mt-16">
              <div className="grid grid-cols-12 items-end gap-x-6 gap-y-4">
                <div className="col-span-12 md:col-span-7">
                  <p className="mk-overline text-tomato">C.08, Pairings</p>
                  <h3 className="font-display mt-4 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                    Four recipes you can cook with.
                  </h3>
                </div>
                <div className="col-span-12 md:col-span-5 md:pb-2">
                  <div className="mb-3 flex md:justify-end">
                    <UseInFigma href="https://www.figma.com/community/file/pizzadao-pairings" label="Use these pairings" />
                  </div>
                  <p className="text-sm leading-relaxed text-ink/70 md:text-base max-w-[60ch]">
                    Treat these as the house combinations. Anything outside this list needs a reason.
                  </p>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                {[
                  {
                    code: "P.01",
                    label: "Sauce + Flour",
                    headline: "Pizza the planet.",
                    desc: "Maximum signal. Hero bands, posters, stickers, anywhere the brand needs to shout in one breath.",
                    bg: "bg-tomato",
                    fg: "text-cream",
                    sub: "text-cream/80",
                    chipBg: "bg-cream/15",
                    chipFg: "text-cream",
                  },
                  {
                    code: "P.02",
                    label: "Cheese + Char",
                    headline: "Real rooms, real heat.",
                    desc: "Highlight bands, community sections, the Mission moment. Warmth without raising the volume.",
                    bg: "bg-butter",
                    fg: "text-ink",
                    sub: "text-ink/70",
                    chipBg: "bg-ink/10",
                    chipFg: "text-ink",
                  },
                  {
                    code: "P.03",
                    label: "Sauce + Cheese",
                    headline: "Block party energy.",
                    desc: "Posters, party flyers, sticker drops. Saved for the loudest community moments, never the default.",
                    bg: "bg-butter",
                    fg: "text-tomato",
                    sub: "text-ink/70",
                    chipBg: "bg-tomato/15",
                    chipFg: "text-tomato",
                  },
                  {
                    code: "P.04",
                    label: "Flour + Char",
                    headline: "The long read.",
                    desc: "The default. Body copy, indexes, captions, anything that needs to be read for more than ten seconds.",
                    bg: "bg-cream",
                    fg: "text-ink",
                    sub: "text-ink/70",
                    chipBg: "bg-ink/10",
                    chipFg: "text-ink",
                  },
                ].map((p) => (
                  <article
                    key={p.code}
                    className={`flex h-full flex-col justify-between gap-8 rounded-3xl p-8 shadow-sm md:p-10 ${p.bg}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className={`ui text-[10px] font-semibold uppercase tracking-[0.2em] ${p.sub}`}>
                        {p.code}
                      </span>
                      <span
                        className={`ui rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${p.chipBg} ${p.chipFg}`}
                      >
                        {p.label}
                      </span>
                    </div>
                    <div>
                      <p className={`font-display text-3xl font-extrabold leading-[0.95] md:text-4xl ${p.fg}`}>
                        {p.headline}
                      </p>
                      <p className={`mt-4 max-w-md text-sm leading-relaxed md:text-base ${p.sub}`}>
                        {p.desc}
                      </p>
                    </div>
                  </article>
                ))}
              </div>

              {/* Color Do / Don't */}
              <DoDont
                doExample={
                  <div className="flex w-full max-w-[260px] items-center gap-3 rounded-xl bg-tomato px-5 py-4 shadow-sm">
                    <span className="font-display text-2xl font-extrabold text-cream">Slice up</span>
                    <span className="ui ml-auto rounded-full bg-cream/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream">CTA</span>
                  </div>
                }
                dontExample={
                  <div className="flex w-full max-w-[260px] items-center gap-3 rounded-xl bg-tomato px-5 py-4 shadow-sm">
                    <span className="font-display text-2xl font-extrabold text-butter">Slice up</span>
                    <span className="ui ml-auto rounded-full bg-butter/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-butter">CTA</span>
                  </div>
                }
                note="Pair each lead color with Cream or Char. Don't stack two saturated brand colors against each other - it kills legibility."
              />

            </div>
          </div>
        </div>
      </section>


      {/* § B.07, Build with PizzaDAO programmatically */}
      <section id="brand-md" className="mk-paper-soft paper-drift relative overflow-hidden bg-cream py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">brand.md · v1.0</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-8">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.07, For builders</p><span className="mk-handwritten rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">fork it, ship it</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Build with PizzaDAO,
                  <br />
                  <span className="text-ink/60">programmatically.</span>
                </h2>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-8">
                <p className="text-lg leading-relaxed text-ink/80">
                  Brand infrastructure for builders and AI agents. Spec it, ship it, stay on-brand by default.
                </p>
              </div>
            </div>

            <div className="mt-12 grid grid-cols-12 gap-6 md:mt-16">
              {/* Brand.md */}
              <article className="col-span-12 flex flex-col rounded-3xl border-2 border-ink bg-cream p-6 md:col-span-6 md:p-10">
                <div className="flex items-center justify-between gap-3">
                  <span className="ui inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">
                    <FileCode2 className="h-3.5 w-3.5" />
                    Brand.md
                  </span>
                  <span className="ui rounded-full border border-ink/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/60">
                    Available
                  </span>
                </div>

                <h3 className="font-display mt-6 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                  A brand the machine can read.
                </h3>
                <p className="mt-4 text-base leading-relaxed text-ink/75 max-w-[60ch]">
                  A single markdown file encoding voice, tone, color tokens, and usage patterns. Drop it into your repo, prompt, or agent, keep output on-brand without thinking about it.
                </p>

                <pre className="ui mt-6 overflow-x-auto rounded-xl border border-ink/15 bg-ink p-4 text-[12px] leading-relaxed text-cream/90">
{`# PizzaDAO, Brand.md
voice: warm, plain, slightly playful
colors:
  tomato: "#F83A3A"
  butter: "#FFD23F"
  cream:  "#FBF7EC"
do:    [generosity, sentence case, plain words]
dont:  [all caps, corporate jargon]`}
                </pre>

                <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                  <a
                    href="https://github.com/pizzadao/pizzadao-brand-kit/blob/main/Brand.md"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => track(EVT.BRAND_ASSET_DOWNLOADED, { asset: "brand_md", surface: "brand_md_section" })}
                    className="mk-btn-pill bg-ink text-cream hover:bg-tomato"
                  >
                    <Download className="h-4 w-4" />
                    Download Brand.md
                  </a>
                  <a
                    href="https://github.com/pizzadao/pizzadao-brand-kit"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackOutbound("Brand kit source", "https://github.com/pizzadao/pizzadao-brand-kit", { surface: "brand_md_section" })}
                    className="mk-btn-pill border border-ink/20 bg-cream text-ink hover:border-ink hover:bg-butter"
                  >
                    <Github className="h-4 w-4" />
                    View source
                  </a>
                </div>

              </article>

              {/* MCP */}
              <article className="col-span-12 flex flex-col rounded-3xl border-2 border-ink bg-ink p-6 text-cream md:col-span-6 md:p-10">
                <div className="flex items-center justify-between gap-3">
                  <span className="ui inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-butter">
                    <Terminal className="h-3.5 w-3.5" />
                    MCP server
                  </span>
                  <span className="ui rounded-full bg-tomato px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cream">
                    Coming soon
                  </span>
                </div>

                <h3 className="font-display mt-6 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                  An endpoint your agents can call.
                </h3>
                <p className="mt-4 text-base leading-relaxed text-cream/75">
                  A Model Context Protocol endpoint that serves brand assets, tokens, and guidelines on demand, so any tool or agent can generate PizzaDAO-aligned content.
                </p>

                <ul className="mt-6 space-y-2 text-sm text-cream/80">
                  {[
                    "Live tokens & assets",
                    "Voice + tone presets",
                    "Mascot variants on request",
                    "Drop-in for any MCP-aware agent",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <Sparkles className="h-3.5 w-3.5 text-butter" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                  <button
                    type="button"
                    disabled
                    className="mk-btn-pill cursor-not-allowed bg-cream/15 text-cream/60"
                  >
                    Endpoint pending
                  </button>
                  <a
                    href="mailto:hello@pizzadao.org?subject=MCP%20early%20access"
                    className="mk-btn-pill border border-cream/30 bg-transparent text-cream hover:border-cream hover:bg-cream/10"
                  >
                    Get notified
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* § B.08, In the wild */}
      <section id="applications" className="mk-halftone-soft relative overflow-hidden bg-[hsl(var(--ink)/0.035)] py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-5 top-4 z-10 hidden md:block"><span className="mk-handwritten rotate-[2deg] text-ink/40 text-xs md:text-sm leading-none">in the wild · 2024–25</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-12">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.08, In the wild</p><span className="mk-handwritten -rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">out there, on purpose</span><span className="ui inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-cream px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/55"><span aria-hidden className="h-1 w-1 rounded-full bg-tomato" /> Just added · Berlin</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Out there. On walls.<br />
                  <span className="text-ink/60">In hands. On phones.</span>
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <div className="mb-4 flex md:justify-end">
                  <UseInFigma href="https://www.figma.com/community/file/pizzadao-layouts" label="Open layout templates" />
                </div>
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Selected sightings from chapters across the network. Posters, merch, projections, packaging - Benny in the wild, 2024–2026.
                </p>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-12 gap-2 md:mt-10 md:gap-3">
              <figure className="relative col-span-12 overflow-hidden rounded-2xl bg-ink sm:col-span-6 lg:col-span-5 lg:row-span-2">
                <img
                  src={wildProjection}
                  alt="PizzaDAO Mafia characters projected on a giant LED wall above a crowd"
                  width={1920}
                  height={1280}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover lg:aspect-[3/4]"
                />
                <figcaption className="ui pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/90 backdrop-blur-sm">
                  01 · Projection wall
                </figcaption>
              </figure>

              <figure className="relative col-span-12 overflow-hidden rounded-2xl bg-ink sm:col-span-6 lg:col-span-7">
                <img
                  src={wildBitcoin}
                  alt="‘Ten Thousand Bitcoin’ projected across a long event wall in warm orange"
                  width={1920}
                  height={1280}
                  loading="lazy"
                  className="aspect-[5/3] w-full object-cover"
                />
                <figcaption className="ui pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/90 backdrop-blur-sm">
                  02 · Stage signage
                </figcaption>
              </figure>

              <figure className="relative col-span-6 overflow-hidden rounded-2xl bg-ink lg:col-span-3">
                <img
                  src={wildBoxes}
                  alt="Custom PizzaDAO Global Pizza Party 2025 Los Angeles pizza boxes"
                  width={1200}
                  height={1500}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <figcaption className="ui pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/90 backdrop-blur-sm">
                  03 · Pizza boxes
                </figcaption>
              </figure>

              <figure className="tape-corner relative col-span-6 overflow-hidden rounded-2xl bg-ink lg:col-span-4">
                <img
                  src={wildTee}
                  alt="Community member holding a PizzaDAO NYC Bazaar t-shirt"
                  width={1200}
                  height={1500}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <figcaption className="ui pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/90 backdrop-blur-sm">
                  04 · Merch in hand
                </figcaption>
              </figure>

              <figure className="relative col-span-12 overflow-hidden rounded-2xl bg-ink lg:col-span-7">
                <img
                  src={wildArrow}
                  alt="A PizzaDAO ‘Free Pizza!’ giant arrow sign carried across a venue stage"
                  width={1500}
                  height={1500}
                  loading="lazy"
                  className="aspect-[16/9] w-full object-cover"
                />
                <figcaption className="ui pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/90 backdrop-blur-sm">
                  05 · Free Pizza arrow
                </figcaption>
              </figure>
            </div>

            <div className="ui mt-6 flex items-center justify-between gap-4 pt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55">
              <span>5 sightings · live archive</span>
              <span className="text-tomato">Tag #pizzadao to land here</span>
            </div>

          </div>
        </div>
      </section>

      {/* § B.08b, Motion */}
      <section id="motion" className="mk-paper-soft mk-paper-soft-dark paper-drift mk-ink-spread relative overflow-hidden bg-ink py-24 text-cream md:py-36">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-cream/45">Motion brief · v0.3</span></div>
          <div className="container">
          <div className="border-t border-cream/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-butter">§ B.08b, Motion</p><span className="mk-handwritten rotate-[1.5deg] text-butter/85 text-sm md:text-base leading-none">easy on the eyes</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  How the brand moves.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-cream/75 md:text-lg">
                  A loop of the live GIFs the community ships every week, across socials, decks, and Telegram. Reference only. Grab the source from the brand kit.
                </p>
              </div>
            </div>

            <div className="mt-12 grid grid-cols-12 gap-4 md:gap-6">
              {[
                { src: "https://pizzadao.github.io/pizzadao-brand-kit/gifs/gif1.gif", code: "MO.01", span: "col-span-12 md:col-span-7 md:row-span-2", aspect: "aspect-[4/3]" },
                { src: "https://pizzadao.github.io/pizzadao-brand-kit/gifs/gif2.gif", code: "MO.02", span: "col-span-6 md:col-span-5", aspect: "aspect-square" },
                { src: "https://pizzadao.github.io/pizzadao-brand-kit/gifs/gif3.gif", code: "MO.03", span: "col-span-6 md:col-span-5", aspect: "aspect-square" },
                { src: "https://pizzadao.github.io/pizzadao-brand-kit/gifs/gif4.gif", code: "MO.04", span: "col-span-6 md:col-span-6", aspect: "aspect-[4/3]" },
                { src: "https://pizzadao.github.io/pizzadao-brand-kit/gifs/gif5.gif", code: "MO.05", span: "col-span-6 md:col-span-6", aspect: "aspect-[4/3]" },
              ].map((g) => (
                <figure key={g.code} className={`group relative overflow-hidden rounded-3xl border border-cream/15 bg-cream/5 ${g.span}`}>
                  <img
                    src={g.src}
                    alt={`PizzaDAO animated brand asset ${g.code}`}
                    loading="lazy"
                    className={`w-full ${g.aspect} object-cover`}
                  />
                  <figcaption className="pointer-events-none absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/85 backdrop-blur-sm ui">
                    {g.code}
                  </figcaption>
                </figure>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 pt-6">
              <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-cream/55">
                5 loops · live from pizzadao.github.io/pizzadao-brand-kit
              </p>
              <a
                href="https://pizzadao.github.io/pizzadao-brand-kit/#gifs"
                target="_blank"
                rel="noopener noreferrer"
                className="ui inline-flex items-center gap-1.5 text-[12px] font-semibold text-cream hover:text-butter"
              >
                See all in the brand kit <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* § B.08c, Party Flyer Guidelines */}
      <section id="flyers" className="mk-print-noise relative overflow-hidden bg-cream py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-5 top-4 z-10 hidden md:block"><span className="mk-handwritten rotate-[2deg] text-ink/40 text-xs md:text-sm leading-none">community remix</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.08c, Party flyers</p><span className="mk-handwritten -rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">tape one up</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Make a flyer.
                </h2>
                <div className="mt-5 flex items-center gap-3">
                  <span aria-hidden className="reg-mark" />
                  <span className="prod-stamp">Print ready · A3</span>
                </div>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Hosting a chapter party? Commission a local artist to interpret Benny in your city. Three steps, simple specs, real examples.
                </p>
              </div>
            </div>

            {/* Process, submit → review → finalize */}
            <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm md:grid-cols-3">
              {[
                { n: "01", t: "Submit", d: "Hire a local illustrator. Send a draft of your city's Benny to the Graphic Review chat." },
                { n: "02", t: "Review", d: "PizzaDAO reviews. One round of notes, fast turnaround. Iterate with your artist." },
                { n: "03", t: "Finalize", d: "Deliver editable source files. We add it to the global flyer archive." },
              ].map((s) => (
                <li key={s.n} className="flex flex-col gap-4 bg-cream p-5 md:p-7">
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">P.{s.n}</span>
                  <h3 className="font-display text-3xl font-extrabold leading-[0.95] md:text-4xl">{s.t}</h3>
                  <p className="text-sm leading-relaxed text-ink/70 max-w-[60ch]">{s.d}</p>
                </li>
              ))}
            </ol>

            {/* Specs, basic */}
            <div className="mt-10">
              <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-ink/15 shadow-sm sm:grid-cols-3">
                {[
                  { label: "Format", value: "Square primary · poster + banner if needed" },
                  { label: "Files", value: "Figma preferred · or .ai / .psd" },
                  { label: "Budget", value: "Up to $150 art · up to $100 design" },
                ].map((s) => (
                  <li key={s.label} className="flex flex-col gap-2 bg-cream p-5">
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/55">{s.label}</span>
                    <span className="font-display text-lg font-semibold text-ink md:text-xl">{s.value}</span>
                  </li>
                ))}
              </ul>
              <a
                href="https://t.me/+uF9BfD-pQz9kNTRh"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackOutbound("Graphic Review Telegram", "https://t.me/+uF9BfD-pQz9kNTRh", { surface: "flyers" })}
                className="ui mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-cream transition-colors hover:bg-tomato"
              >
                Open Graphic Review chat <ArrowUpRight className="h-4 w-4" />
              </a>

            </div>

            {/* Examples */}
            <div className="mt-16">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><p className="mk-overline text-tomato">F.01, From the chapters</p><span aria-hidden className="reg-mark" /><span className="ui inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-cream px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/55"><span aria-hidden className="h-1 w-1 rounded-full bg-tomato" /> Latest · Lagos poster</span></div><span className="prod-stamp">Proof · v1.0</span></div>
              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
                {[
                  { src: flyerPizzaFuture, city: "Toronto", title: "Pizza Future" },
                  { src: flyerDaoTokyo, city: "Tokyo", title: "DAO Tokyo" },
                  { src: flyerPizzaFesta, city: "Lisboa", title: "Pizza Festa" },
                ].map((f) => (
                  <figure key={f.title} className="crop-marks relative rounded-3xl bg-cream shadow-sm">
                    <div className="aspect-square overflow-hidden rounded-t-3xl">
                      <img
                        src={f.src}
                        alt={`${f.title}, PizzaDAO party flyer from ${f.city}`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <figcaption className="flex items-center justify-between border-t border-ink/15 px-5 py-3">
                      <span className="font-display text-base font-semibold text-ink">{f.title}</span>
                      <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55">{f.city}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* § B.10, Molto Benny */}
      <section id="molto-benny" className="mk-halftone-soft relative overflow-hidden bg-butter py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-4 top-4 z-10 hidden md:block"><span className="ui text-[9px] font-medium uppercase tracking-[0.26em] text-ink/35">Mascot pack · Stickers</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            {/* Masthead */}
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-8">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="mk-overline text-tomato">§ B.10, Mascot</p><span className="mk-handwritten rotate-[1.5deg] text-tomato/85 text-sm md:text-base leading-none">say hi to benny</span></div>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Meet Molto Benny.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-8">
                <p className="text-lg leading-relaxed text-ink/80">
                  Three eyes. A whistle. The hand. Everything else can evolve, keep the soul, remix the rest.
                </p>
              </div>
            </div>

            {/* Core primitives, what must stay */}
            <div className="mt-12 grid grid-cols-12 gap-6 md:mt-16">
              <div className="relative col-span-12 overflow-hidden rounded-3xl bg-cream shadow-sm md:col-span-7">
                <span aria-hidden className="mk-handwritten pointer-events-none absolute left-5 top-4 z-10 -rotate-[2deg] text-sm leading-none text-tomato/70 md:text-base">benny should always feel alive</span>
                <div className="relative aspect-[4/3] p-8 md:p-14">
                  <img
                    src={moltoBenny}
                    alt="Molto Benny, three-eyed pizza slice mascot, whistling, with Italian hand gesture, standing on a pizza box"
                    width={1024}
                    height={1024}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-ink/15 px-5 py-3">
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/60">
                    Fig. 01, Canonical Benny
                  </span>
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-tomato">
                    Hands off the eyes
                  </span>
                </div>
              </div>

              <div className="col-span-12 md:col-span-5">
                <div className="rounded-3xl border-2 border-ink bg-ink p-6 text-cream md:p-7">
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-butter">M.00, Core primitives</p>
                    <span className="ui rounded-full border border-cream/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream/80">
                      Spec · locked
                    </span>
                  </div>
                  <h3 className="font-display mt-3 text-2xl font-extrabold leading-[0.95] text-cream md:text-3xl">
                    Three things must stay.
                  </h3>
                  <ul className="mt-5 divide-y divide-cream/15 border-y border-cream/15">
                    {[
                      { n: "01", t: "Three eyes", d: "Always three. Never two, never four." },
                      { n: "02", t: "Whistling lips", d: "Pursed, mid-whistle. Not a smile, not a smirk." },
                      { n: "03", t: "Italian hand gesture", d: "Pinched fingers, pointed up. The chef's kiss." },
                    ].map((p) => (
                      <li key={p.t} className="flex items-start gap-4 py-3">
                        <span className="ui w-7 shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-butter">
                          {p.n}
                        </span>
                        <div className="flex-1">
                          <span className="font-display block text-xl font-extrabold leading-[1.05] text-cream md:text-2xl">
                            {p.t}
                          </span>
                          <span className="ui mt-1 block text-[12px] font-medium text-cream/65">
                            {p.d}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="ui mt-4 text-[12px] font-medium leading-relaxed text-cream/65">
                    Style, medium, outfit, mood, the box he stands on, all yours. Keep the three, and it's still Benny.
                  </p>
                </div>
              </div>
            </div>

            {/* Variants, only the real ones */}
            <div className="mt-16">
              <div className="flex items-end justify-between gap-6 pt-6">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="mk-overline text-tomato">M.01, Official variants</p>
                  <span className="ui inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-cream px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/55">
                    <span aria-hidden className="h-1 w-1 rounded-full bg-tomato" /> New · São Paulo variation
                  </span>
                </div>
                <span className="ui hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55 md:block">
                  Source · pizzadao.github.io/pizzadao-brand-kit
                </span>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-ink/15 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
                {/* Full color */}
                <article className="flex flex-col bg-cream">
                  <div className="flex aspect-square items-center justify-center bg-cream p-6 ring-1 ring-inset ring-ink/10">
                    <img src="/marketing/brand-kit/molto-benny/molto-benny-color.png" alt="Molto Benny full color" loading="lazy" className="max-h-full w-auto object-contain" />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">M.01.a</span>
                    <h4 className="font-display text-xl font-extrabold leading-[1]">Full color</h4>
                    <p className="text-xs leading-relaxed text-ink/70">The canonical Benny. Default for everything unless the surface forces otherwise.</p>
                    <div className="ui mt-auto flex gap-2">
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-color.png"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-semibold text-cream transition-colors hover:bg-tomato"
                      >
                        <Download className="h-3.5 w-3.5" /> PNG
                      </a>
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-color.svg"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-ink px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-cream"
                      >
                        <Download className="h-3.5 w-3.5" /> SVG
                      </a>
                    </div>
                  </div>
                </article>

                {/* Black */}
                <article className="flex flex-col bg-cream">
                  <div className="flex aspect-square items-center justify-center bg-cream p-6 ring-1 ring-inset ring-ink/10">
                    <img src="/marketing/brand-kit/molto-benny/molto-benny-black.png" alt="Molto Benny black monochrome" loading="lazy" className="max-h-full w-auto object-contain" />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">M.01.b</span>
                    <h4 className="font-display text-xl font-extrabold leading-[1]">Black</h4>
                    <p className="text-xs leading-relaxed text-ink/70">Single-color treatment for stencils, stickers, and one-color print.</p>
                    <div className="ui mt-auto flex gap-2">
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-black.png"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-semibold text-cream transition-colors hover:bg-tomato"
                      >
                        <Download className="h-3.5 w-3.5" /> PNG
                      </a>
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-black.svg"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-ink px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-cream"
                      >
                        <Download className="h-3.5 w-3.5" /> SVG
                      </a>
                    </div>
                  </div>
                </article>

                {/* White */}
                <article className="flex flex-col bg-cream">
                  <div className="flex aspect-square items-center justify-center bg-ink p-6">
                    <img src="/marketing/brand-kit/molto-benny/molto-benny-white.png" alt="Molto Benny white monochrome on ink" loading="lazy" className="max-h-full w-auto object-contain" />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">M.01.c</span>
                    <h4 className="font-display text-xl font-extrabold leading-[1]">White</h4>
                    <p className="text-xs leading-relaxed text-ink/70">Reverse mark for dark backgrounds, night photography, and ink surfaces.</p>
                    <div className="ui mt-auto flex gap-2">
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-white.png"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-semibold text-cream transition-colors hover:bg-tomato"
                      >
                        <Download className="h-3.5 w-3.5" /> PNG
                      </a>
                      <a
                        href="/marketing/brand-kit/molto-benny/molto-benny-white.svg"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-ink px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-cream"
                      >
                        <Download className="h-3.5 w-3.5" /> SVG
                      </a>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            {/* Sticker files, separate from character variants */}
            <div className="relative mt-12 rounded-3xl bg-cream shadow-sm p-5 md:p-8">
              <span aria-hidden className="mk-handwritten pointer-events-none absolute -top-4 right-6 z-10 rotate-[2deg] text-sm leading-none text-ink/45 md:-top-5 md:text-base">works great on shirts too</span>
              <div className="grid grid-cols-12 items-start gap-6">
                <div className="col-span-12 md:col-span-5">
                  <p className="mk-overline text-tomato">M.02, Sticker files</p>
                  <h3 className="font-display mt-4 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                    For the print run.
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-ink/70 max-w-[60ch]">
                    Editable source files for sticker production. Open in Illustrator, scale, recolor, send to your printer.
                  </p>
                </div>
                <div className="col-span-12 md:col-span-7 space-y-5">
                  <div className="overflow-hidden rounded-2xl border border-ink/15">
                    <img
                      src={moltoBennyPrintRun}
                      alt="Box of freshly printed Molto Benny stickers"
                      loading="lazy"
                      className="block h-full w-full object-cover"
                    />
                  </div>
                  <div className="group relative flex items-center justify-between gap-6 overflow-hidden rounded-2xl border border-ink bg-ink p-6 text-cream shadow-[6px_6px_0_0_hsl(var(--tomato))] transition-all hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_hsl(var(--tomato))] md:p-7">
                    <div className="min-w-0">
                      <span className="ui block text-[10px] font-semibold uppercase tracking-[0.2em] text-butter">Final artwork</span>
                      <span className="font-display mt-2 block text-2xl font-extrabold leading-[1.05] md:text-3xl">Molto Benny sticker</span>
                      <span className="ui mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                        <a href="/marketing/brand-kit/stickers/molto-benny-sticker.ai" download className="inline-flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 font-semibold text-ink transition-colors hover:bg-butter">
                          <Download className="h-3 w-3" /> .ai
                        </a>
                        <a href="/marketing/brand-kit/stickers/molto-benny-sticker.pdf" download className="inline-flex items-center gap-1.5 rounded-full border border-cream/30 px-3 py-1.5 font-semibold text-cream transition-colors hover:bg-cream hover:text-ink">
                          <Download className="h-3 w-3" /> .pdf
                        </a>
                      </span>
                    </div>
                    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tomato text-cream transition-transform group-hover:rotate-6">
                      <Download className="h-6 w-6" />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Box note */}
            <div className="mt-10 flex flex-col items-start gap-4 rounded-3xl bg-ink shadow-sm p-6 text-cream md:mt-14 md:flex-row md:items-center md:justify-between md:p-8">
              <div className="max-w-2xl">
                <p className="mk-overline text-butter">A note on the box</p>
                <p className="font-display mt-3 text-2xl font-extrabold leading-[1.05] md:text-3xl">
                  The pizza box is the one part you can swap. Drop a partner mark, a city, a chapter, Benny stands on whatever the moment calls for.
                </p>
              </div>
              <span className="ui shrink-0 rounded-full border border-cream/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cream/80">
                Box = canvas
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* § B.11, How we sound */}
      <section id="voice" className="mk-paper-soft paper-drift relative overflow-hidden bg-[hsl(var(--ink)/0.035)] py-28 md:py-44">
        <div aria-hidden className="pointer-events-none absolute right-5 top-4 z-10 hidden md:block"><span className="mk-handwritten rotate-[2deg] text-ink/40 text-xs md:text-sm leading-none">approved</span></div>
          <div className="container">
          <div className="border-t border-ink/15 pt-10 md:pt-14">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
              <div className="col-span-12 md:col-span-7">
                <p className="mk-overline text-tomato">§ B.11, How we sound</p>
                <h2 className="font-display mt-5 text-5xl font-extrabold leading-[0.88] md:text-7xl">
                  Plain words. Sharp wit.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pb-3">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg max-w-[60ch]">
                  Sentence case. No buzzwords, no hype. Say the warm thing first, then the useful thing. If a line could come from a brand deck, rewrite it.
                </p>
              </div>
            </div>

            {/* Tone tabs */}
            <div className="relative mt-12">
              <span aria-hidden className="mk-handwritten pointer-events-none absolute -top-5 left-3 -rotate-[2deg] text-sm leading-none text-tomato/70 md:-top-6 md:left-4 md:text-base">best used loud</span>
            </div>
            <Tabs defaultValue="warm" className="mt-4">
              <TabsList className="flex h-auto w-full justify-start gap-2 rounded-full border border-ink/15 bg-cream p-1">
                {[
                  { v: "warm", l: "Warm" },
                  { v: "direct", l: "Direct" },
                  { v: "witty", l: "Witty" },
                ].map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    className="ui rounded-full px-5 py-2 text-sm font-semibold text-ink/60 data-[state=active]:bg-ink data-[state=active]:text-cream"
                  >
                    {t.l}
                  </TabsTrigger>
                ))}
              </TabsList>

              {[
                {
                  v: "warm",
                  code: "V.01",
                  n: "Default",
                  d: "Friendly, generous, never precious. The voice of someone holding the door open.",
                  ex: ["Pull up a chair. The pizza's hot.", "Bring a friend. Bring two.", "Everyone eats."],
                },
                {
                  v: "direct",
                  code: "V.02",
                  n: "Always",
                  d: "Short sentences. One idea each. Cut the qualifier before the qualifier.",
                  ex: ["Host your city.", "Pick a date. Pick a slice. Send the invite.", "75+ cities. 6 continents. One party."],
                },
                {
                  v: "witty",
                  code: "V.03",
                  n: "In small doses",
                  d: "A wink, not a punchline. Earned, never forced. Nothing that needs a rim shot.",
                  ex: ["Pizza the planet.", "A neighborhood is a network.", "Hot, cheap, and yours."],
                },
              ].map((t) => (
                <TabsContent key={t.v} value={t.v} className="mt-6 rounded-3xl bg-cream shadow-sm p-5 md:p-8">
                  <div className="grid grid-cols-12 gap-x-6 gap-y-6">
                    <div className="col-span-12 md:col-span-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">{t.code}</span>
                        <span className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55">{t.n}</span>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed text-ink/75 max-w-[60ch] md:text-base">{t.d}</p>
                    </div>
                    <ul className="col-span-12 divide-y divide-ink/12 border-t border-ink/15 md:col-span-8 md:border-l md:border-t-0 md:border-ink/15 md:pl-8">
                      {t.ex.map((line) => (
                        <li key={line} className="py-4 first:pt-0 md:first:pt-4">
                          <p className="font-display text-2xl font-extrabold leading-[1] text-ink md:text-3xl">{line}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            {/* Headlines: yes / no */}
            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <div className="rounded-3xl bg-cream shadow-sm p-5 md:p-7">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-tomato" />
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">V.04 · Headlines we'd ship</span>
                </div>
                <ul className="mt-5 divide-y divide-ink/12 border-y border-ink/15">
                  <li className="py-4">
                    <p className="font-display text-2xl font-extrabold leading-[1] text-ink md:text-3xl">Pizza the planet.</p>
                  </li>
                  <li className="py-4">
                    <p className="font-display text-2xl font-extrabold leading-[1] text-ink md:text-3xl">A neighborhood is a network.</p>
                  </li>
                  <li className="py-4">
                    <p className="font-display text-2xl font-extrabold leading-[1] text-ink md:text-3xl">Hot, cheap, and yours.</p>
                  </li>
                </ul>
              </div>
              <div className="rounded-3xl bg-cream shadow-sm p-5 md:p-7">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink/45" />
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">V.05 · Headlines we wouldn't</span>
                </div>
                <ul className="mt-5 divide-y divide-ink/12 border-y border-ink/15">
                  <li className="py-4">
                    <p className="font-display text-2xl font-semibold leading-[1.1] text-ink/40 line-through md:text-3xl">Empowering the future of community-led food sovereignty.</p>
                  </li>
                  <li className="py-4">
                    <p className="font-display text-2xl font-semibold leading-[1.1] text-ink/40 line-through md:text-3xl">Disrupting the global pizza ecosystem.</p>
                  </li>
                  <li className="py-4">
                    <p className="font-display text-2xl font-semibold leading-[1.1] text-ink/40 line-through md:text-3xl">PIZZADAO, A REVOLUTION IN SHARING.</p>
                  </li>
                </ul>
              </div>
            </div>

            {/* CTAs */}
            <div className="mt-10 rounded-3xl bg-ink shadow-sm p-6 text-cream md:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-butter">V.06 · CTAs</span>
                  <p className="font-display mt-2 text-3xl font-extrabold leading-[0.95] md:text-4xl">Verbs, not slogans.</p>
                </div>
                <span className="ui hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-cream/55 md:block">2–4 words · sentence case</span>
              </div>
              <div className="mt-6 flex flex-wrap gap-3 pt-6">
                {["Join the party", "Host your city", "Read the mission", "Download the kit", "Pull up a chair"].map((c) => (
                  <span key={c} className="ui inline-flex items-center rounded-full border border-cream/30 px-4 py-2 text-sm font-semibold text-cream">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default BrandSystemPage;
