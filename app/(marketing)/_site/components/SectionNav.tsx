"use client";

import { useEffect, useState } from "react";

const items = [
  { id: "overview", label: "Overview" },
  { id: "principles", label: "Brand Principles" },
  { id: "color", label: "Color System" },
  { id: "typography", label: "Typography" },
  { id: "voice", label: "Voice & Tone" },
  { id: "molto-benny", label: "Molto Benny" },
  { id: "applications", label: "Applications" },
  { id: "flyers", label: "Make a Flyer" },
  { id: "downloads", label: "Downloads" },
];

const SectionNav = () => {
  const [active, setActive] = useState(items[0].id);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrolled = doc.scrollTop;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, scrolled / max) : 0);

      const trigger = window.innerHeight * 0.35;
      let current = items[0].id;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - trigger <= 0) current = it.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  const activeLabel = items.find((i) => i.id === active)?.label ?? "";

  return (
    <>
      {/* Desktop: fixed left rail, full height */}
      <nav
        aria-label="Section navigation"
        className="fixed left-0 top-0 z-40 hidden h-screen w-[180px] flex-col border-r border-ink/12 bg-ink/[0.03] lg:flex"
      >
        <div className="flex h-full flex-col overflow-y-auto pt-24 pb-8">
          <div className="px-5 pb-4">
            <p className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/40">
              § B, Sections
            </p>
          </div>
          <ol className="flex flex-col">
            {items.map((it) => {
              const isActive = active === it.id;
              return (
                <li key={it.id} className="relative">
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 bg-tomato"
                    />
                  )}
                  <a
                    href={`#${it.id}`}
                    onClick={(e) => handleClick(e, it.id)}
                    className={`block px-5 py-2.5 text-[10.5px] uppercase tracking-[0.16em] transition-colors ${
                      isActive
                        ? "font-bold text-ink"
                        : "font-medium text-ink/45 hover:text-ink/80"
                    }`}
                  >
                    {it.label}
                  </a>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto px-5 pt-6">
            <div className="h-px w-full bg-ink/10">
              <div
                className="h-px bg-tomato transition-[width] duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile: sticky top dropdown */}
      <div className="sticky top-16 z-30 border-b border-ink/15 bg-cream/95 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ui flex w-full items-center justify-between px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            <span className="text-ink/40">Section</span>
            <span>{activeLabel}</span>
          </span>
          <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        {open && (
          <ol className="border-t border-ink/10 bg-cream pb-2">
            {items.map((it) => {
              const isActive = active === it.id;
              return (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    onClick={(e) => handleClick(e, it.id)}
                    className={`ui flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-[0.14em] ${
                      isActive ? "font-bold text-ink" : "font-medium text-ink/50"
                    }`}
                  >
                    <span className={`h-px ${isActive ? "w-6 bg-tomato" : "w-3 bg-ink/30"}`} />
                    {it.label}
                  </a>
                </li>
              );
            })}
          </ol>
        )}
        <div className="h-px w-full bg-ink/10">
          <div className="h-px bg-tomato transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </>
  );
};

export default SectionNav;
