"use client";

const img01 = "/marketing/assets/partners/activation-01.png";
const img02 = "/marketing/assets/partners/activation-02.png";
const img03 = "/marketing/assets/partners/activation-03.png";
const img04 = "/marketing/assets/partners/activation-04.png";
const img05 = "/marketing/assets/partners/activation-05.png";
const img06 = "/marketing/assets/partners/activation-06.png";
const img07 = "/marketing/assets/partners/activation-07.png";
type Frame = {
  src: string;
  alt: string;
  city: string;
  year: string;
  type: string;
  ref: string;
  /** subtle, deliberate rotation - keeps the strip imperfect */
  rotate: string;
  /** vertical nudge in px - varies the baseline so it reads as collage, not grid */
  yOffset: number;
};

const FRAMES: Frame[] = [
  { src: img03, alt: "Stand With Crypto activation night crowd in pixel pizza glasses.", city: "New York",   year: "'24", type: "Brand activation", ref: "PL.03", rotate: "-rotate-[0.8deg]",  yOffset: 0  },
  { src: img04, alt: "Guests sharing pizza at a pink-themed brand activation.",          city: "Miami",      year: "'24", type: "Brand activation", ref: "PL.04", rotate: "rotate-[0.6deg]",   yOffset: 14 },
  { src: img02, alt: "Pixel-glasses portrait, slice in hand, night light.",              city: "Berlin",     year: "'23", type: "Chapter night",    ref: "PL.02", rotate: "-rotate-[0.5deg]",  yOffset: 6  },
  { src: img01, alt: "Chapter holding decorated pies in front of a red storefront.",     city: "Buenos Aires", year: "'24", type: "Chapter meet",   ref: "PL.01", rotate: "rotate-[0.7deg]",   yOffset: 22 },
  { src: img06, alt: "Pizzaiolo holding a fresh margherita by a tiled oven.",            city: "San Francisco", year: "'23", type: "Partner moment",   ref: "PL.06", rotate: "-rotate-[0.6deg]",  yOffset: 8  },
  { src: img05, alt: "Four people backstage holding slices, smiling.",                   city: "Los Angeles", year: "'24", type: "Brand activation",ref: "PL.05", rotate: "rotate-[0.5deg]",   yOffset: 18 },
  { src: img07, alt: "Team posing on a red carpet at the World Pizza Games.",            city: "Las Vegas",  year: "'24", type: "Partner moment",   ref: "PL.07", rotate: "-rotate-[0.4deg]",  yOffset: 2  },
];

// Consistent warm/monochrome-ish grade applied to every frame
const GRADE = "saturate(0.85) contrast(1.06) sepia(0.10) brightness(0.99)";

const PartnerActivations = () => {
  return (
    <section className="mk-paper-soft relative overflow-hidden bg-cream py-12 md:py-16">
      {/* Soft warm wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, hsl(44 55% 96%) 0%, hsl(var(--cream)) 50%, hsl(44 60% 97%) 100%)",
        }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-ink/10" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-ink/10" />

      <div className="container relative">
        {/* Editorial header */}
        <div className="grid grid-cols-12 items-end gap-x-8 gap-y-3 border-b border-ink/15 pb-5 md:gap-x-12">
          <div className="col-span-12 md:col-span-8">
            <p className="mk-overline text-tomato">§ B.01.5 - Plates</p>
            <h2 className="font-display mt-2 text-[clamp(1.8rem,3.6vw,3rem)] font-extrabold leading-[1] tracking-[-0.02em] text-ink">
              Activation energy, from the field.
            </h2>
          </div>
          <div className="col-span-12 md:col-span-4">
            <p className="font-serif text-[14.5px] leading-[1.55] text-ink/65 md:text-[15.5px]">
              A tight strip from the last two years - chapter nights, brand
              activations, partner moments. Captured by the people there.
            </p>
          </div>
        </div>

        {/* Impact strip - overlapping frames, uniform crop, collaged baseline.
            Mobile: horizontal scroll-snap. Desktop: full-width flex with overlaps. */}
        <div className="relative mt-8 md:mt-10">
          <div
            className="
              -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3
              [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
              md:mx-0 md:gap-0 md:overflow-visible md:px-0 md:pb-0
            "
          >
            {FRAMES.map((f, i) => (
              <figure
                key={f.ref}
                className={`
                  group relative shrink-0 snap-start animate-fade-in
                  w-[64%] sm:w-[42%]
                  md:w-[calc((100%+72px)/7)] md:shrink md:[&:not(:first-child)]:-ml-[12px]
                  ${f.rotate}
                  transition-transform duration-700 ease-out hover:rotate-0 hover:z-10
                `}
                style={{
                  animationDelay: `${i * 60}ms`,
                  animationFillMode: "both",
                  transform: undefined,
                  marginTop: `${f.yOffset}px`,
                  zIndex: i % 2 === 0 ? 2 : 1,
                }}
              >
                <div
                  data-benny="true"
                  className="relative overflow-hidden bg-ink/5 shadow-[0_14px_30px_-18px_hsl(0_0%_0%/0.40),0_2px_5px_-2px_hsl(0_0%_0%/0.18)] ring-1 ring-ink/10"
                >
                  <img
                    src={f.src}
                    alt={f.alt}
                    loading="lazy"
                    decoding="async"
                    className="block h-full w-full object-cover aspect-[4/5] transition-transform duration-[1400ms] ease-out group-hover:scale-[1.03]"
                    style={{ filter: GRADE }}
                  />
                  {/* Subtle warm wash unifies grading across all frames */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 mix-blend-multiply"
                    style={{ background: "hsl(38 35% 68% / 0.06)" }}
                  />
                  {/* Grain over the image for tactile feel */}
                  <div
                    aria-hidden
                    className="mk-grain pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-multiply"
                  />
                  {/* Tiny edge stamp - ref number, like a contact-sheet mark */}
                  <span className="ui absolute bottom-1.5 right-1.5 rounded-sm bg-cream/85 px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.22em] text-ink/65 backdrop-blur-[1px]">
                    {f.ref}
                  </span>
                </div>
                {/* Compact metadata - year · type, single line, never wraps */}
                <figcaption className="mt-2 flex items-baseline gap-2 whitespace-nowrap overflow-hidden">
                  <span className="ui text-[9px] font-medium uppercase tracking-[0.22em] text-ink/40">
                    {f.year}
                  </span>
                  <span className="ui truncate text-[9px] font-medium uppercase tracking-[0.22em] text-ink/40">
                    · {f.type}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>

          {/* Edge fade hints scrollability on mobile, vanishes on desktop */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-8 md:hidden"
            style={{ background: "linear-gradient(90deg, hsl(var(--cream)), transparent)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-8 md:hidden"
            style={{ background: "linear-gradient(270deg, hsl(var(--cream)), transparent)" }}
          />
        </div>

        {/* Footer rule */}
        <div className="mt-8 flex items-center gap-3 md:mt-10">
          <div className="h-px flex-1 bg-ink/8" />
          <span className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-ink/30">
            Field archive · ongoing
          </span>
          <div className="h-px flex-1 bg-ink/8" />
        </div>
      </div>
    </section>
  );
};

export default PartnerActivations;
