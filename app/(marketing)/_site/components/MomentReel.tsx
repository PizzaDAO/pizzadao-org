"use client";

const party = "/marketing/assets/party.jpg";
const MomentReel = () => {
  return (
    <section
      id="moments"
      className="relative isolate overflow-hidden bg-butter text-ink"
    >
      {/* Ambient WenPizza video layer - same source as the phone, softened and yellow-tinted */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-butter">
        <video
          src="/media/video/wen-pizza-nyc.mp4"
          poster={party}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          className="h-full w-full scale-[1.08] object-cover opacity-90 blur-[6px] saturate-[0.85] contrast-90 brightness-110"
        />
        {/* Bright butter wash to keep yellow vivid and avoid muddy tones */}
        <div className="absolute inset-0 bg-butter/60 mix-blend-multiply" />
        <div className="absolute inset-0 bg-butter/25" />
        {/* Subtle vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 60%, hsl(var(--ink) / 0.10) 100%)",
          }}
        />
      </div>

      {/* Grain texture */}
      <div className="mk-grain pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      <div className="container py-20 md:py-28">
        <div className="grid grid-cols-12 items-center gap-x-4 gap-y-12 md:gap-x-6">
          {/* LEFT, copy */}
          <div className="col-span-12 md:col-span-7 lg:col-span-7">
            <p className="mk-overline text-tomato">Live from the Mafia</p>
            <h2 className="font-display mt-4 text-display-1 font-extrabold leading-[0.92]">
              Real rooms.
              <br />
              Real slices.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-ink/80 md:text-lg">
              Clips from chapter parties, hackathon kitchens, and the sauce
              that brings a global community together.

            </p>


            <a
              href="https://www.instagram.com/Pizza_DAO/"
              target="_blank"
              rel="noreferrer"
              className="ui mt-6 inline-flex items-center gap-2 border-b border-ink pb-1 text-xs font-semibold tracking-[0.04em] text-ink hover:border-tomato hover:text-tomato"
            >
              View more on Instagram →
            </a>
          </div>

          {/* RIGHT, phone frame */}
          <div className="col-span-12 md:col-span-5 lg:col-span-5">
            <div className="flex justify-center md:justify-start lg:-ml-6">
              <div className="relative">
                {/* Soft glow under phone */}
                <div
                  className="absolute -inset-8 -z-10 rounded-[3rem] blur-3xl"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, hsl(var(--tomato) / 0.25), transparent 70%)",
                  }}
                  aria-hidden="true"
                />
                {/* Bezel */}
                <div className="rounded-[2.75rem] bg-ink p-3 shadow-[var(--shadow-lifted)] ring-1 ring-ink/10 md:p-3.5">
                  <div className="relative aspect-[9/19.5] w-[260px] overflow-hidden rounded-[2.25rem] bg-ink md:w-[300px] lg:w-[320px]">
                    {/* Notch */}
                    <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-ink/95" />
                    <video
                      src="/media/video/wen-pizza-nyc.mp4"
                      poster={party}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="none"
                      aria-label="PizzaDAO moments"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MomentReel;
