"use client";

import { useState } from "react";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import Sponsorship from "@/app/(marketing)/_site/components/Sponsorship";
import PartnersGlobe from "@/app/(marketing)/_site/components/PartnersGlobe";
import PartnerActivations from "@/app/(marketing)/_site/components/PartnerActivations";
import RegistrationMarks from "@/app/(marketing)/_site/components/RegistrationMarks";
import { track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";
import { invokeForm, honeypot } from "@/app/(marketing)/_site/lib/forms";
import Honeypot from "@/app/(marketing)/_site/components/Honeypot";



const paypalLogo = "/marketing/assets/partners/paypal.png";
const ledgerLogo = "/marketing/assets/partners/ledger.svg";
const standWithCryptoLogo = "/marketing/assets/partners/stand-with-crypto.png";
const braveLogo = "/marketing/assets/partners/brave.png";
const openseaLogo = "/marketing/assets/partners/opensea.png";
const coinbaseLogo = "/marketing/assets/partners/coinbase.png";
const polygonLogo = "/marketing/assets/partners/polygon.png";
const ensLogo = "/marketing/assets/partners/ens.png";
// `scale` optically normalizes logos so they read at the same visual weight.
// Tuned by eye, not by math — each mark balanced against PayPal as anchor.
const PARTNERS = [
  { name: "PayPal", logo: paypalLogo, scale: 0.95 },
  { name: "Coinbase", logo: coinbaseLogo, scale: 0.68 },
  { name: "Polygon", logo: polygonLogo, scale: 1.06 },
  { name: "Ledger", logo: ledgerLogo, scale: 1.12 },
  { name: "Brave", logo: braveLogo, scale: 0.95 },
  { name: "OpenSea", logo: openseaLogo, scale: 0.77 },
  { name: "Stand With Crypto", logo: standWithCryptoLogo, scale: 0.95 },
  { name: "ENS", logo: ensLogo, scale: 0.65 },
];



const PartnersPage = () => {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({ brand: "", name: "", email: "", brief: "" });


  return (
    <main className="mk-grain min-h-screen bg-cream text-ink">
      <SiteNav solid />

      {/* Editorial hero - global cultural initiative */}
      <section className="mk-paper-soft relative overflow-hidden bg-cream pt-10 md:pt-14">
        {/* Atmospheric warmth - cream → warm gradient */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, hsl(var(--cream)) 0%, hsl(44 70% 96%) 55%, hsl(40 55% 93%) 100%)",
          }}
        />
        {/* Editorial crop marks - printer's register, art-directed corners */}
        <RegistrationMarks tone="ink" opacity={0.18} inset={22} size={14} folio="§ B.01" />
        {/* Subtle checker corners - brand signature, intentional rhythm */}
        <div
          aria-hidden
          className="checker-tape pointer-events-none absolute right-0 top-0 h-[5px] w-32 opacity-30 md:w-48"
        />
        <div
          aria-hidden
          className="checker-tape pointer-events-none absolute bottom-0 left-0 h-[5px] w-32 opacity-25 md:w-48"
        />

        <div className="container relative">
          {/* Archival ref */}
          <div className="flex items-center justify-between pb-3">
            <span className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/45">
              GPP archive · vol. 04
            </span>
            <span className="ui flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/45">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-tomato" />
              Ongoing, est. 2021
            </span>
          </div>

          <div className="border-t border-ink/40 pt-6 md:pt-8">
            <div className="grid grid-cols-12 items-center gap-x-8 gap-y-6 md:gap-x-12">
              {/* Left: headline mass + lede */}
              <div className="col-span-12 md:col-span-7 animate-fade-in">
                <p className="mk-overline text-tomato">§ B, Partnership</p>
                <h1 className="font-display mt-3 font-extrabold leading-[0.84] tracking-[-0.025em] text-[clamp(3.25rem,9vw,8.5rem)] md:leading-[0.8]">
                  Where brands meet{" "}
                  <span className="relative inline-block">
                    <span
                      className="mk-handwritten inline-block text-tomato-deep"
                      style={{
                        transform: "rotate(-1.5deg)",
                        fontSize: "0.62em",
                        lineHeight: 1,
                        verticalAlign: "0.18em",
                        letterSpacing: "-0.005em",
                      }}
                    >
                      real-world
                    </span>
                  </span>{" "}
                  <span className="text-ink">attention.</span>
                </h1>

                <p className="font-serif mt-5 max-w-[44ch] text-[17.5px] leading-[1.55] text-ink/75 md:text-[19px] md:leading-[1.5]">
                  PizzaDAO builds global, community-driven activations that turn
                  brands into experiences people actually show up for.
                </p>
                <p className="ui mt-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ink/45">
                  Trusted globally · since 2021
                </p>
              </div>

              {/* Right: ambient globe */}
              <div className="col-span-12 md:col-span-5 animate-fade-in" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
                <PartnersGlobe />
                <p className="ui mt-3 text-center text-[10px] font-medium uppercase tracking-[0.24em] text-ink/40">
                  Fig. i - Active chapters, 6 continents
                </p>
              </div>
            </div>

            {/* Proof strip - editorial footer rail */}
            <div className="relative mt-7 border-t border-ink/15 pt-4 pb-8 md:mt-9 md:pt-5 md:pb-12">
              {/* Asymmetric IRL stamp - offset into the margin */}
              <span
                aria-hidden
                className="mk-handwritten absolute -top-3 right-0 -rotate-[8deg] text-[13px] text-tomato md:right-2"
              >
                ↘ measured IRL
              </span>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4 md:gap-x-12">
                {[
                  { k: "Cities", v: "400+" },
                  { k: "Countries", v: "100+" },
                  { k: "Attendees", v: "20,000+" },
                  { k: "Years running", v: "6" },
                ].map((m) => (
                  <div key={m.k} className="flex flex-col gap-1.5">
                    <dd className="font-display text-[2rem] font-extrabold leading-none tracking-[-0.02em] md:text-[2.5rem]">
                      {m.v}
                    </dd>
                    <dt className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-ink/45">
                      {m.k}
                    </dt>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* Reuse homepage Sponsorship section for value props + CTA */}
      <Sponsorship />

      {/* Selected collaborators - editorial interlude, museum supporters wall */}
      <section className="mk-paper-soft relative overflow-hidden bg-cream pb-14 pt-10 md:pb-20 md:pt-14">
        {/* Tonal continuity wash - soft warm paper bleeding into next section */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, hsl(var(--cream)) 0%, hsl(44 55% 96%) 50%, hsl(40 50% 94%) 100%)",
          }}
        />
        {/* Faint warm grain overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-multiply"
          style={{
            backgroundImage:
              "radial-gradient(hsl(var(--ink)) 1px, transparent 1px)",
            backgroundSize: "3px 3px",
          }}
        />
        <RegistrationMarks
          tone="ink"
          opacity={0.09}
          inset={18}
          size={10}
          corners={["tl", "br"]}
          folio="§ B.02"
        />

        <div className="container relative">
          {/* Centered editorial header - stronger hierarchy */}
          <div className="mx-auto max-w-[58ch] text-center">
            <p className="ui text-[10px] font-semibold uppercase tracking-[0.3em] text-ink/50">
              Selected collaborators
            </p>
            <h2 className="font-serif mt-3 text-[20px] leading-[1.4] text-ink/85 md:text-[24px] md:leading-[1.35]">
              Organizations we've collaborated with across culture, technology, and community.
            </h2>
            {/* Soft hairline divider */}
            <div
              aria-hidden
              className="mx-auto mt-7 h-px w-16 bg-ink/15 md:mt-9"
            />
          </div>

          {/* Two-row centered composition - slightly asymmetric grouping */}
          {(() => {
            const rows: { items: typeof PARTNERS; gap: string; mt: string }[] = [
              // Row 1: 4 marks - PayPal, Coinbase, Polygon, Ledger
              { items: PARTNERS.slice(0, 4), gap: "gap-x-12 md:gap-x-20", mt: "mt-9 md:mt-12" },
              // Row 2: 4 marks - Brave, OpenSea, Stand With Crypto, ENS
              { items: PARTNERS.slice(4, 8), gap: "gap-x-12 md:gap-x-20", mt: "mt-9 md:mt-12" },
            ];
            let n = 0;
            return rows.map((row, ri) => (
              <div
                key={ri}
                className={`flex flex-wrap items-center justify-center gap-y-9 ${row.gap} ${row.mt}`}
              >
                {row.items.map((p) => {
                  const idx = n++;
                  return (
                    <div
                      key={p.name}
                      className="group relative flex h-8 items-center animate-fade-in md:h-9"
                      style={{ animationDelay: `${idx * 90}ms`, animationFillMode: "both" }}
                    >
                      <div
                        className="relative flex h-full items-center"
                        style={{ transform: `scale(${p.scale})`, transformOrigin: "center" }}
                      >
                        <img
                          src={p.logo}
                          alt={`${p.name} logo`}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 m-auto h-full w-auto object-contain opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-90"
                          style={{ minWidth: "100px" }}
                        />
                        <div
                          aria-hidden
                          className="h-full transition-opacity duration-500 ease-out group-hover:opacity-0"
                          style={{
                            width: "130px",
                            WebkitMaskImage: `url(${p.logo})`,
                            maskImage: `url(${p.logo})`,
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                            backgroundColor: "hsl(var(--ink) / 0.62)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}

          {/* Integrated editorial annotation - centered beneath logo field */}
          <div className="mt-12 flex flex-col items-center gap-1 md:mt-16">
            <p className="mk-handwritten -rotate-[1.5deg] text-[14px] text-ink/45">
              ↳ trusted globally, city by city
            </p>
            <p className="ui text-[9.5px] font-medium uppercase tracking-[0.28em] text-ink/35">
              IRL participation · since 2020
            </p>
          </div>
        </div>
      </section>





      {/* Activation gallery - field photography from partner moments */}
      <PartnerActivations />

      {/* Inquiry - warm close, hospitality cues */}
      <section className="mk-paper-soft mk-paper-soft-dark paper-drift relative overflow-hidden bg-ink py-14 text-cream md:py-16">
        {/* Single directional warm wash - anchored to where the headline sits,
            so the warmth reads as light on a page, not as a floating blob. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 70% at 18% 35%, hsl(var(--tomato) / 0.10) 0%, transparent 60%)",
          }}
        />
        {/* Diagonal paper-fold crease - soft, intentional, runs through the gutter */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(112deg, transparent 47%, hsl(var(--cream) / 0.05) 49.5%, transparent 52%)",
          }}
        />
        {/* Brand signature tape - single, deliberate */}
        <div className="checker-tape-sm absolute left-0 top-0 h-[4px] w-24 opacity-35 md:w-40" aria-hidden />
        {/* Editorial registration marks - cream on ink, two corners only */}
        <RegistrationMarks
          tone="cream"
          opacity={0.18}
          inset={20}
          size={12}
          corners={["tr", "bl"]}
          folio="§ B.03"
        />
        {/* Bottom hairline */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-cream/8" aria-hidden />

        <div className="container relative">
          <div className="grid grid-cols-12 gap-x-8 gap-y-8 md:gap-x-14 md:gap-y-0">
            {/* Left: headline + copy, tightly grouped */}
            <div className="col-span-12 md:col-span-5 lg:col-span-5">
              <p className="mk-overline text-butter">§ B.02 - Inquiry</p>
              <h2 className="font-display mt-4 text-display-2 font-extrabold leading-[0.88] tracking-[-0.025em]">
                Tell us
                <br />
                what you're
                <br />
                <span
                  className="mk-handwritten inline-block text-butter"
                  style={{
                    transform: "rotate(-2deg)",
                    fontSize: "0.78em",
                    verticalAlign: "0.1em",
                  }}
                >
                  trying to do.
                </span>
              </h2>
              <p className="font-serif mt-5 max-w-[34ch] text-[15px] leading-[1.6] text-cream/65 md:text-base">
                We'll come back with a brief, a city list, and a number, usually within a week.
              </p>
              <p className="ui mt-5 text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/35">
                Or email partnerships@pizzadao.org directly
              </p>

              {/* Handwritten hospitality phrase */}
              <p className="mk-handwritten mt-5 -rotate-[1.5deg] text-butter/80 text-[14px]">
                ↳ start with an idea
              </p>
            </div>


            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (submitting) return;
                setSubmitError(null);
                setSubmitting(true);
                track(EVT.PARTNERS_CTA_CLICKED, { position: "inquiry_form", action: "submit" });
                try {
                  const { error } = await invokeForm("/api/public/contact", {
                    body: {
                      name: form.name.trim(),
                      organization: form.brand.trim() || undefined,
                      email: form.email.trim(),
                      message: form.brief.trim(),
                      intents: ["Partnership"],
                      website: honeypot(e),
                    },
                  });
                  if (error) throw error;
                  setSubmitted(true);
                } catch (err) {
                  console.error(err);
                  setSubmitError(
                    "Something went wrong sending your brief. Please try again or email partnerships@pizzadao.org directly.",
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
              className="col-span-12 grid grid-cols-2 gap-x-5 gap-y-6 md:col-span-7 md:pl-8 lg:pl-12"
            >
              <Honeypot />
              {submitted ? (
                <div className="col-span-2">
                  <div className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-butter">
                    ● Received
                  </div>
                  <p className="font-display mt-4 text-2xl font-extrabold leading-tight md:text-3xl">
                    Thanks. A partnership lead will be in touch within 5 business days.
                  </p>
                </div>
              ) : (
                <>
                  <div className="col-span-2 md:col-span-1">
                    <label className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/45">
                      Brand
                    </label>
                    <input
                      type="text"
                      required
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      className="ui mt-2.5 w-full border-0 border-b border-cream/20 bg-transparent px-0 py-2.5 text-sm text-cream placeholder:text-cream/25 transition-colors focus:border-butter focus:outline-none"
                      placeholder="Company name"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/45">
                      Your name
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="ui mt-2.5 w-full border-0 border-b border-cream/20 bg-transparent px-0 py-2.5 text-sm text-cream placeholder:text-cream/25 transition-colors focus:border-butter focus:outline-none"
                      placeholder="Full name"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/45">
                      Work email
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="ui mt-2.5 w-full border-0 border-b border-cream/20 bg-transparent px-0 py-2.5 text-sm text-cream placeholder:text-cream/25 transition-colors focus:border-butter focus:outline-none"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/45">
                      Tell us the brief (1–3 sentences)
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={form.brief}
                      onChange={(e) => setForm((f) => ({ ...f, brief: e.target.value }))}
                      className="ui mt-2.5 w-full border-0 border-b border-cream/20 bg-transparent px-0 py-2.5 text-sm text-cream placeholder:text-cream/25 transition-colors focus:border-butter focus:outline-none"
                      placeholder="What you're trying to achieve, where, by when."
                    />
                  </div>
                  {submitError && (
                    <div role="alert" className="col-span-2 ui text-xs text-butter">
                      {submitError}
                    </div>
                  )}
                  <div className="relative col-span-2 mt-2 flex flex-col-reverse items-start gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="group relative inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-tomato px-7 py-4 text-sm font-semibold tracking-[0.03em] text-cream shadow-[0_10px_28px_-10px_hsl(var(--tomato)/0.6),0_3px_8px_-4px_hsl(0_0%_0%/0.3)] transition-all duration-500 ease-out hover:-translate-y-[3px] hover:bg-butter hover:text-ink hover:shadow-[0_18px_48px_-14px_hsl(var(--butter)/0.5),0_6px_14px_-6px_hsl(0_0%_0%/0.35)] disabled:cursor-not-allowed disabled:opacity-60 md:px-9 md:py-5"
                    >
                      <span>{submitting ? "Sending…" : "Request a partnership brief"}</span>
                      <span aria-hidden className="transition-transform duration-500 ease-out group-hover:translate-x-1">→</span>
                    </button>
                  </div>
                </>
              )}
            </form>

          </div>
        </div>
      </section>


      <Footer />
    </main>
  );
};

export default PartnersPage;
