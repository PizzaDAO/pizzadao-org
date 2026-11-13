"use client";

const heroCrowd = "/marketing/assets/hero-crowd.jpg";
import { ArrowRight, ArrowUpRight } from "lucide-react";

const TICKER = [
  "New York", "London", "Lagos", "Tokyo", "Berlin", "São Paulo",
  "Mumbai", "Mexico City", "Buenos Aires", "Sydney", "Bangkok",
  "Istanbul", "Nairobi", "Toronto", "Global Pizza Party",
  "75+ cities", "6 continents", "Est. 2021", "One slice at a time",
];

const Hero = () => {
  const loop = [...TICKER, ...TICKER, ...TICKER];

  return (
    <section id="top" className="relative bg-tomato text-cream">
      <div className="container relative pt-24 pb-12 md:pt-36 md:pb-14">
        {/* Headline + supporting column */}
        <div className="grid grid-cols-12 gap-x-6 gap-y-8 md:gap-y-10">
          <div className="col-span-12 md:col-span-9">
            <h1 className="font-display text-mega font-black leading-[0.86] mk-fade-up">
              Pizza the
              <br />
              Planet.
            </h1>
          </div>

          <div className="col-span-12 md:col-span-3 md:pt-6">
            <p className="text-lg leading-snug text-cream/95 md:text-[17px] md:leading-relaxed">
              PizzaDAO brings people together around pizza.
            </p>
            <p className="ui mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-cream/70">
              Community first. <span className="text-butter">Pizza always.</span>
            </p>

            <div className="mt-7 flex flex-col gap-3 md:items-stretch">
              <a
                href="#join"
                className="mk-btn-pill group bg-cream text-ink hover:bg-butter"
              >
                Join the Pizza Mafia
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
              <a
                href="#work"
                className="mk-btn-pill group border border-cream/60 text-cream hover:bg-cream hover:text-ink"
              >
                Explore our work
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </div>
        </div>

        {/* Contained hero image */}
        <figure className="mt-12 md:mt-16">
          <div className="relative overflow-hidden rounded-2xl" data-benny="true">
            <img
              src={heroCrowd}
              alt="A packed Bitcoin Pizza Day crowd glowing under amber stage lights at a global PizzaDAO event"
              className="block aspect-[3/4] w-full object-cover md:aspect-[16/10]"
              width={1920}
              height={1200}
              fetchPriority="high"
            />
          </div>
          <figcaption className="ui mt-4 flex flex-col items-start justify-between gap-1.5 text-[10px] uppercase tracking-[0.22em] text-cream/75 md:flex-row md:items-center md:text-[11px]">
            <span>Global Pizza Party · worldwide</span>
            <span className="text-cream/55">75+ cities · 6 continents · one slice at a time</span>
          </figcaption>
        </figure>
      </div>

      {/* Refined ticker, integrated into the hero band */}
      <div className="border-y border-cream/15">
        <div className="overflow-hidden py-3">
          <div className="mk-marquee-track flex w-max gap-8 whitespace-nowrap">
            {loop.map((t, i) => (
              <span
                key={i}
                className="ui flex items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.22em] text-cream/80"
              >
                {t}
                <span className="text-cream/30" aria-hidden>·</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
