"use client";

import { ArrowUpRight } from "lucide-react";

const Mission = () => {
  return (
    <section id="mission" className="relative bg-butter text-ink">
      <div className="container py-20 md:py-36">
        <div className="grid grid-cols-12 gap-x-6 gap-y-10">
          <div className="col-span-12 md:col-span-2">
            <p className="mk-overline text-tomato">Mission</p>
          </div>
          <div className="col-span-12 md:col-span-10">
            <h2 className="font-display text-[clamp(2.5rem,7.5vw,7rem)] font-extrabold leading-[0.92]">
              Our mission is to build community
              and support local businesses by bringing people together around a{" "}
              <span className="mk-handwritten text-tomato text-[1.05em]">shared love for pizza</span>.
            </h2>

            <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-12 md:gap-x-6">
              <div className="md:col-span-7" aria-hidden />

              <div className="md:col-span-5 md:pl-6 md:pt-2">
                <a
                  href="/about"
                  className="mk-btn-pill-lg group bg-ink text-cream hover:bg-tomato"
                >
                  Read our story
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Mission;
