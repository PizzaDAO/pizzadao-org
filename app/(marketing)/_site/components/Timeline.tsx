"use client";

import { useRef } from "react";
const t2010 = "/marketing/assets/timeline-2010.jpg";
const tFounding = "/marketing/assets/timeline-founding.jpg";
const tParty = "/marketing/assets/timeline-party.jpg";
const tPresent = "/marketing/assets/timeline-present.jpg";
type Chapter = {
  kicker: string;
  title: string;
  body: string;
  pull: string;
  attribution?: string;
  img: string;
  alt: string;
  meta: string;
};

const CHAPTERS: Chapter[] = [
  {
    kicker: "The first transaction",
    title: "10,000 BTC for two pizzas.",
    body: "A programmer paid in bitcoin. A meal became a monument.",
    pull: "I'll pay 10,000 bitcoin for a couple of pizzas… like maybe 2 large ones.",
    attribution: ", Laszlo Hanyecz, BitcoinTalk forum",
    img: t2010,
    alt: "Laszlo Hanyecz at home with his two children and the two large pizzas bought for 10,000 BTC",
    meta: "Bitcoin Pizza Day · Origin",
  },
  {
    kicker: "The founding",
    title: "A community forms around the myth.",
    body: "Organizers turned the internet's most famous meal into an annual party.",
    pull: "We didn't invent the holiday. We just decided to throw the party.",
    img: tFounding,
    alt: "Late-night gathering of friends huddled around laptops and pizza",
    meta: "PizzaDAO Founded",
  },
  {
    kicker: "The movement",
    title: "Global Pizza Party goes worldwide.",
    body: "From a handful of cities to hundreds, baking together on the same weekend.",
    pull: "One weekend. Hundreds of cities. The same ribbon, in every language.",
    img: tParty,
    alt: "PizzaDAO chapter delivering pizzas to nurses and staff at a hospital's Department of Rehabilitation Medicine",
    meta: "Annual Activation",
  },
  {
    kicker: "The institution",
    title: "A global cultural body.",
    body: "420+ cities, $1M+ donated, 60+ active chapters. The myth became infrastructure.",
    pull: "Pizza was the invitation. Community is the work.",
    img: tPresent,
    alt: "Mosaic of PizzaDAO chapters worldwide, community gatherings across six continents",
    meta: "Present Day",
  },
];

const Timeline = () => {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85 * dir;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <section
      id="timeline"
      className="relative bg-cream pt-20 md:pt-32"
    >
      {/* Masthead */}
      <div className="container">
        <div className="border-t-2 border-ink pt-8 md:pt-10">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
            <div className="col-span-12 md:col-span-7">
              <p className="mk-overline text-tomato">The Mythology</p>
              <h2 className="font-display mt-4 text-display-1 font-extrabold leading-[0.88]">
                A meal that
                <br />
                <span className="text-ink/70">became a movement.</span>
              </h2>
            </div>
            <div className="col-span-12 md:col-span-5 md:pl-8">
              <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                Every organization has an origin story. Ours starts with a
                programmer, two pizzas, and ten thousand bitcoin, and
                culminates in a global pizza party.

              </p>
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => scroll(-1)}
                  aria-label="Previous"
                  className="ui flex h-12 w-12 items-center justify-center rounded-full border border-ink text-lg text-ink transition-colors hover:bg-ink hover:text-cream"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => scroll(1)}
                  aria-label="Next"
                  className="ui flex h-12 w-12 items-center justify-center rounded-full border border-ink bg-ink text-lg text-cream transition-colors hover:bg-tomato hover:border-tomato"
                >
                  →
                </button>
                <span className="ui ml-2 text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  Swipe · scroll
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline rail */}
      <div className="relative mt-14 md:mt-20">
        {/* Continuous baseline rule */}
        <div className="pointer-events-none absolute left-0 right-0 top-[44%] hidden h-px bg-ink/20 md:block" />


        <div
          ref={trackRef}
          className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-5 pb-16 [scroll-padding-left:1.25rem] md:gap-8 md:px-10 md:pb-24 md:[scroll-padding-left:2.5rem] lg:px-16"
          style={{ scrollbarWidth: "thin" }}
        >
          {CHAPTERS.map((c, i) => (
            <article
              key={c.kicker}
              className="group relative flex w-[86%] shrink-0 snap-start flex-col bg-cream sm:w-[70%] md:w-[44%] lg:w-[36%]"
            >

              {/* Image */}
              <figure className="mk-grain relative mt-5 overflow-hidden rounded-2xl">
                <img
                  src={c.img}
                  alt={c.alt}
                  loading="lazy"
                  className="block aspect-[4/5] w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.03]"
                  width={1080}
                  height={1350}
                />
                <figcaption className="ui absolute bottom-3 right-3 flex items-center text-[10px] uppercase tracking-[0.18em] text-cream/80 mix-blend-difference">
                  <span>{c.meta}</span>
                </figcaption>
              </figure>

              {/* Body */}
              <div className="mt-6">
                <p className="mk-overline text-tomato">{c.kicker}</p>
                <h3 className="font-display mt-3 text-3xl font-extrabold leading-[0.95] md:text-4xl">
                  {c.title}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-ink/75">
                  {c.body}
                </p>

                <blockquote className="mt-6">
                  <div>
                    <p className="font-display text-lg font-extrabold leading-tight text-ink md:text-xl">
                      {c.pull}
                    </p>
                    {c.attribution && (
                      <cite className="ui mt-2 block text-[10px] not-italic uppercase tracking-[0.18em] text-ink/55">
                        {c.attribution}
                      </cite>
                    )}
                  </div>
                </blockquote>
              </div>
            </article>
          ))}

          {/* End plate */}
          <div className="flex w-[40%] shrink-0 snap-start flex-col justify-end pb-8 md:w-[24%]">
            <div className="border-t-2 border-ink pt-5">
              <p className="mk-overline text-tomato">To be continued</p>
              <p className="font-display mt-3 text-3xl font-extrabold leading-tight md:text-4xl">
                The next page
                <br />
                <span className="text-ink/60">is unwritten.</span>
              </p>
              <p className="mt-4 text-sm leading-relaxed text-ink/65">
                The next decade of PizzaDAO will be written by the people who
                show up. That includes you.
              </p>
              <a
                href="#join"
                className="ui mt-5 inline-flex items-center gap-2 border-b-2 border-ink pb-1 text-xs font-semibold tracking-[0.18em] text-ink hover:border-tomato hover:text-tomato"
              >
                Join the Mafia →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Timeline;
