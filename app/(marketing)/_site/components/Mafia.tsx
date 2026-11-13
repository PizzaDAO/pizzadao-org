"use client";

import { ArrowUpRight } from "lucide-react";

const NAMES = [
  "Pepperoni Ritchie", "Pepper Mortensen", "Cheese Lucas", "Don Heebie Jeebies",
  "Mushroom Escobar", "Don Diablo", "Chorizo Corleone", "The Sauce",
  "Oscar Frog", "Don Mami", "Don Luv", "Pineapple Sorvino",
  "Papa Mush", "Don Pizza Czech", "Anchovies Montana", "Don Menta Jengibre",
  "Margherita Ciro", "Halsteady", "Capo Crust", "Sister Marinara",
  "Calzone Capone", "Mozz DeNiro", "Basil Bambino", "Olive Pacino",
  "Provolone Pesci", "Salami Sinatra", "Don Doughboy", "Crusty Tony",
  "Sister Sicilian", "Garlic Gambino",
];

const Mafia = () => {
  const loop = [...NAMES, ...NAMES];

  return (
    <section className="relative bg-butter py-20 text-ink md:py-36">
      <div className="container">
        <div className="grid grid-cols-12 gap-x-6 gap-y-12 border-t-2 border-ink pt-10 md:gap-y-16">
          {/* LEFT, editorial statement */}
          <div className="col-span-12 md:col-span-6">
            <p className="mk-overline text-tomato">The Pizza Mafia</p>
            <h2 className="font-display mt-5 text-[clamp(3rem,9vw,7.5rem)] font-extrabold leading-[0.86] tracking-[-0.01em]">
              5 Years.
              <br />
              Thousands of
              <br />
              <span className="text-tomato">Pizza Mafia.</span>
            </h2>
            <p className="mt-10 max-w-md text-lg leading-relaxed text-ink/85 md:text-xl">
              The Pizza Mafia started in a Clubhouse room in 2021 with a few
              people talking about pizza, the internet, and bringing the world
              together. Five years later it is a worldwide cast of organizers,
              chefs, artists, and operators who keep the PizzaDAO dough spinning.

            </p>
            <a
              href="#join"
              className="mk-btn-pill-lg group mt-12 bg-ink text-cream hover:bg-tomato"
            >
              Join the family
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </div>

          {/* RIGHT, living membership wall */}
          <div className="col-span-12 md:col-span-6 md:pl-8">
            <div className="ui mb-4 flex items-center justify-between border-b border-ink/15 pb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">

              <span>● Active members</span>
              <span>3,000+ worldwide</span>
            </div>
            <div className="relative h-[26rem] overflow-hidden rounded-2xl border border-ink/15 bg-cream md:h-[38rem]">
              <div className="mk-mask-fade-y h-full overflow-hidden">
                <div className="mk-scroll-y-track">
                  {loop.map((n, i) => (
                    <div
                      key={`${n}-${i}`}
                      className="group flex items-baseline justify-between border-b border-ink/15 px-6 py-4 transition-colors hover:bg-butter/60 md:px-7 md:py-5"
                    >
                    <div className="flex items-baseline gap-5 md:gap-6">
                      <span className="font-display text-2xl font-extrabold leading-tight tracking-[-0.005em] md:text-3xl">
                        {n}
                      </span>
                    </div>
                      <span className="ui text-[10px] uppercase tracking-[0.2em] text-ink/35 transition-colors group-hover:text-tomato">
                        Member
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="ui mt-4 text-[10px] uppercase tracking-[0.22em] text-ink/55">
              The membership wall · always scrolling
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Mafia;
