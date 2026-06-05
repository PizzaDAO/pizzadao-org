// app/ui/onboarding/FilmPoster.tsx
//
// sicilian-99996 — Poster card for the NameStep movie picker.
// Tries to load a real poster from Wikipedia via `useFilmPoster`. While that
// is loading (or if it fails), renders a tone-driven CSS composition so the
// grid never shows a blank tile. Ported from the Lovable mockup
// (src/components/FilmPoster.tsx).
"use client";

import { type MafiaFilm } from "@/app/lib/mafia-films";
import { useFilmPoster } from "@/app/lib/hooks/use-film-poster";

// Pick a tone-driven palette so each "poster" feels distinct without
// external assets.
const PALETTES: Array<{
  keys: string[];
  from: string;
  via: string;
  to: string;
  accent: string;
  ink: string;
}> = [
  { keys: ["sicilian", "operatic", "patriarchal", "cosa nostra"], from: "#1a0a08", via: "#5c1a12", to: "#0a0504", accent: "#e8b84a", ink: "#fbf3d8" },
  { keys: ["wiseguy", "queens", "brooklyn", "scorsese", "little italy"], from: "#0a0a0a", via: "#3a1f12", to: "#0a0a0a", accent: "#f83a3a", ink: "#fbf7ec" },
  { keys: ["miami", "cuban", "cocaine", "neon", "80s", "vapor"], from: "#1a0a2a", via: "#7a1e6a", to: "#0a1530", accent: "#ff7ad9", ink: "#fdf0ff" },
  { keys: ["las vegas", "casino", "high roller"], from: "#1a0a0a", via: "#6a1212", to: "#1a0a0a", accent: "#ffd23f", ink: "#fff0c8" },
  { keys: ["yakuza", "tokyo", "okinawa", "kitano", "japan"], from: "#0a0a14", via: "#1a2a4a", to: "#050510", accent: "#ff4d6d", ink: "#f0f4ff" },
  { keys: ["triad", "hong kong"], from: "#0a0512", via: "#4a0a3a", to: "#0a0512", accent: "#ffcc33", ink: "#fff5e0" },
  { keys: ["heist", "noir", "melville", "kubrick", "rififi"], from: "#0a0a0a", via: "#1a1a1a", to: "#000000", accent: "#cdd6e0", ink: "#fbf7ec" },
  { keys: ["prohibition", "chicago", "lawmen", "cagney", "classic", "pre-code", "1930s"], from: "#1a1208", via: "#3a2818", to: "#0a0604", accent: "#d9b06a", ink: "#fbf3d8" },
  { keys: ["camorra", "naples", "verite", "brutal", "favela", "rio"], from: "#0e1208", via: "#3a4a1a", to: "#080a04", accent: "#f7c948", ink: "#f6ffd8" },
  { keys: ["london", "cockney", "brit", "ira", "russian mob"], from: "#06080c", via: "#1a2a3a", to: "#04060a", accent: "#e63946", ink: "#eef3f8" },
  { keys: ["french", "paris", "corsican", "70s", "audacious"], from: "#0a0612", via: "#2a1a4a", to: "#06040c", accent: "#ffb84d", ink: "#fff0d8" },
  { keys: ["bronx", "coming of age", "stoop", "mentor", "father-son", "nostalgic", "depression-era"], from: "#160d08", via: "#4a2a18", to: "#0a0604", accent: "#f1a32c", ink: "#fbe9c8" },
  { keys: ["harlem", "blaxploitation", "funk", "crack era", "heroin"], from: "#120608", via: "#5a1820", to: "#0a0306", accent: "#ffb000", ink: "#ffe9c8" },
];

const FALLBACK = {
  from: "#0a0a0a",
  via: "#2a1212",
  to: "#050505",
  accent: "#f83a3a",
  ink: "#fbf7ec",
};

function paletteFor(film: MafiaFilm) {
  const tones = film.tone.map((t) => t.toLowerCase());
  for (const p of PALETTES) {
    if (p.keys.some((k) => tones.some((t) => t.includes(k)))) return p;
  }
  return FALLBACK;
}

// Stable pseudo-random from id, so a film always renders the same composition.
function seeded(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return (h >>> 8) / 0xffffff;
  };
}

type Props = { film: MafiaFilm; index?: number };

export function FilmPoster({ film, index }: Props) {
  const p = paletteFor(film);
  const rng = seeded(film.id);
  const angle = Math.round(110 + rng() * 80); // 110-190
  const dotX = Math.round(rng() * 100);
  const dotY = Math.round(rng() * 100);
  const decoX = Math.round(15 + rng() * 70);
  const decoY = Math.round(20 + rng() * 60);
  const decoR = Math.round(40 + rng() * 80);

  // Split title for poster-style stacked typography.
  const words = film.title.replace(/^The\s+/i, "").split(/\s+/);
  const stacked = words.length >= 2 && film.title.length <= 28;

  const { src: posterSrc, loaded, onLoaded } = useFilmPoster(film.id);

  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(${angle}deg, ${p.from}, ${p.via} 55%, ${p.to})`,
      }}
    >
      {posterSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterSrc}
          alt=""
          loading="lazy"
          onLoad={onLoaded}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {posterSrc && loaded && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${p.from}00 35%, ${p.from}cc 100%)`,
          }}
        />
      )}
      {/* Soft glow */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(${decoR}% ${decoR}% at ${dotX}% ${dotY}%, ${p.accent}26, transparent 65%)`,
        }}
      />

      {/* Decorative ring/circle */}
      <svg
        className="absolute inset-0 h-full w-full mix-blend-screen opacity-60"
        viewBox="0 0 100 150"
        preserveAspectRatio="xMidYMid slice"
      >
        <circle
          cx={decoX}
          cy={decoY}
          r={decoR / 2}
          fill="none"
          stroke={p.accent}
          strokeWidth="0.4"
          opacity="0.45"
        />
        <circle
          cx={100 - decoX}
          cy={150 - decoY}
          r={decoR / 3}
          fill="none"
          stroke={p.ink}
          strokeWidth="0.2"
          opacity="0.35"
        />
      </svg>

      {/* Film grain dots */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 30%, rgba(255,255,255,0.6) 0.5px, transparent 1px), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.4) 0.5px, transparent 1px)",
          backgroundSize: "3px 3px, 5px 5px",
        }}
      />

      {/* Top meta */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between px-3 pt-3">
        <span
          className="ui text-[10px] uppercase tracking-[0.28em]"
          style={{ color: `${p.ink}99` }}
        >
          § {String((index ?? 0) + 1).padStart(2, "0")}
        </span>
        <span
          className="ui text-[10px] uppercase tracking-[0.28em]"
          style={{ color: `${p.accent}` }}
        >
          {film.year}
        </span>
      </div>

      {/* Title */}
      <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
        <div
          className="font-[family-name:var(--font-display)] font-black leading-[0.85] tracking-[-0.02em]"
          style={{ color: p.ink }}
        >
          {stacked ? (
            words.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: `clamp(0.9rem, ${Math.max(1.2, 2.4 - w.length * 0.08)}vw, 1.4rem)`,
                }}
              >
                {w}
              </div>
            ))
          ) : (
            <div style={{ fontSize: "clamp(0.9rem, 1.6vw, 1.3rem)" }}>
              {film.title}
            </div>
          )}
        </div>
        <div className="mt-2 h-px w-10" style={{ background: p.accent }} />
        <p
          className="ui mt-2 text-[9px] uppercase tracking-[0.24em]"
          style={{ color: `${p.ink}99` }}
        >
          {film.country}
        </p>
      </div>
    </div>
  );
}

export default FilmPoster;
