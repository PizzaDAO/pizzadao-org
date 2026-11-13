"use client";

const party = "/marketing/assets/party.jpg";
const hackathon = "/marketing/assets/hackathon.jpg";
const pizzeria = "/marketing/assets/pizzeria.jpg";
type Pillar = {
  kicker: string;
  title: string;
  lede: string;
  body: string;
  pull: string;
  img: string;
  imgAlt: string;
  meta: { k: string; v: string }[];
  href: string;
  cta: string;
  external?: boolean;
};

const PILLARS: Pillar[] = [
  {
    kicker: "Flagship Activation",
    title: "Global Pizza Party",
    lede:
      "A worldwide annual celebration of Bitcoin Pizza Day, held in hundreds of cities, on May 22, every year.",
    body:
      "What began as a distributed giveaway directly from pizzerias in 2021 is now the largest decentralized food event on Earth. Independent organizers bake together across continents, funded by the DAO and powered by their own neighborhoods.",
    pull:
      "One day. Hundreds of cities. A ritual across the whole world.",
    img: party,
    imgAlt: "Global Pizza Party 2026 poster, May 22, in a city near you",
    meta: [
      { k: "Cadence", v: "Annual" },
      { k: "Cities", v: "420+" },
      { k: "Since", v: "2021" },
    ],
    href: "https://gpp2026.lovable.app",
    cta: "Visit the event",
    external: true,
  },
  {
    kicker: "Year-round Programming",
    title: "Community Building",
    lede:
      "Art, hackathons, conferences, side events, and all the toppings that keep the global community moving together.",
    body:
      "Between flagship moments, PizzaDAO produces local meetups, residencies, gallery shows, and side events at major cultural events and tech gatherings.",
    pull:
      "The party is the headline. The community is the practice.",
    img: hackathon,
    imgAlt: "Community member coding on a laptop beside a stained-glass arcade cabinet at a PizzaDAO gathering",
    meta: [
      { k: "Format", v: "Always-on" },
      { k: "Programs", v: "Multi-track" },
      { k: "Reach", v: "Global" },
    ],
    href: "/community",
    cta: "Explore the community",
  },
  {
    kicker: "Cultural Infrastructure",
    title: "The Future of Pizza",
    lede:
      "Supporting independent pizzerias and inventing new models for hospitality, technology, and cultural infrastructure.",
    body:
      "We invest in the people behind the ovens, small operators, first-generation owners, neighborhood institutions, and in the open tools that let hospitality thrive without being absorbed by platforms.",
    pull:
      "Independent pizzerias are local infrastructure. We treat them like it.",
    img: pizzeria,
    imgAlt: "Three independent pizzaioli posing together on a red carpet at the International Pizza Challenge",
    meta: [
      { k: "Focus", v: "Independents" },
      { k: "Scope", v: "Hospitality · Tech" },
      { k: "Status", v: "Active R&D" },
    ],
    href: "#future-of-pizza",
    cta: "See what we're building",
  },
];

const Work = () => {
  return (
    <section id="work" className="bg-cream pt-20 md:pt-32">
      {/* Section masthead */}
      <div className="container">
        <div className="border-t-2 border-ink pt-8 md:pt-10">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
            <div className="col-span-12 md:col-span-8">
              <p className="mk-overline text-tomato">Our Work</p>
              <h2 className="font-display mt-5 text-[clamp(3rem,8.5vw,7rem)] font-extrabold leading-[0.86] tracking-[-0.01em]">
                Three pillars.
                <br />
                <span className="mk-handwritten whitespace-nowrap text-tomato text-[0.98em]">One mission.</span>

              </h2>
            </div>
            <div className="col-span-12 md:col-span-4 md:pl-8 md:pb-3">
              <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                PizzaDAO's work is organized around three long-term commitments:
                a flagship global moment, ongoing community building, and
                creating infrastructure for independent pizzerias.

              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Editorial spreads */}
      <div className="mt-16 md:mt-24">
        {PILLARS.map((p, i) => {
          const reverse = i % 2 === 1;
          const isLast = i === PILLARS.length - 1;
          // Middle pillar lifts onto warm yellow for editorial rhythm
          const bg = i === 1 ? "bg-butter" : "bg-cream";
          return (
            <article
              key={p.title}
              className={`${bg} ${isLast ? "pb-16 md:pb-32" : "pb-20 md:pb-32"} pt-20 md:pt-32`}
            >
              <div className="container">
                <div
                  className={`grid grid-cols-12 gap-x-6 gap-y-10 md:gap-y-0 ${
                    reverse ? "md:[&>figure]:order-2" : ""
                  }`}
                >
                  {/* Image side */}
                  <figure
                    className={`relative col-span-12 md:col-span-7 ${
                      reverse ? "md:col-start-6" : ""
                    }`}
                  >
                    <div className="mk-grain relative overflow-hidden rounded-2xl" data-benny="true">
                      <img
                        src={p.img}
                        alt={p.imgAlt}
                        loading="lazy"
                        className="block aspect-[4/5] w-full object-cover md:aspect-[5/6]"
                        width={1280}
                        height={1600}
                      />
                    </div>
                    <figcaption className="ui mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-ink/55">
                      <span>{p.title}</span>
                      <span>{p.kicker}</span>
                    </figcaption>
                  </figure>

                  {/* Text side */}
                  <div
                    className={`col-span-12 md:col-span-5 md:pt-6 ${
                      reverse ? "md:col-start-1 md:row-start-1 md:pr-10" : "md:pl-10"
                    }`}
                  >
                    <p className="mk-overline text-tomato">
                      {p.kicker}
                    </p>
                    <h3 className="font-display mt-4 text-display-2 font-extrabold leading-[0.92]">
                      {p.title}.
                    </h3>

                    <p className="mt-6 text-lg leading-relaxed text-ink/85 md:text-xl">
                      {p.lede}
                    </p>

                    <p className="mt-5 text-base leading-relaxed text-ink/65">
                      {p.body}
                    </p>

                    {/* Pull quote */}
                    <blockquote className="mt-8">
                      <p className="font-display text-xl font-extrabold leading-tight text-ink md:text-2xl">
                        {p.pull}
                      </p>
                    </blockquote>

                    {/* Meta ledger */}
                    <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-ink/15 pt-5">
                      {p.meta.map((m) => (
                        <div key={m.k}>
                          <dt className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55">
                            {m.k}
                          </dt>
                          <dd className="font-display mt-1 text-xl font-extrabold leading-tight md:text-2xl">
                            {m.v}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <a
                      href={p.href}
                      {...(p.external ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="mk-btn-pill group mt-8 bg-ink text-cream hover:bg-tomato"
                    >
                      {p.cta}
                      <span className="transition-transform group-hover:translate-x-1">→</span>
                    </a>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default Work;
