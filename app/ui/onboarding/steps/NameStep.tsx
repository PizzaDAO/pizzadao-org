// app/ui/onboarding/steps/NameStep.tsx
//
// anchovy-28942 — Editorial restyle.
// Visual rewrite of the mafia-name step, modelled on the Lovable mockup's
// `MafiaNamePage`. The Props interface, callbacks, state ownership, and API
// contracts are UNCHANGED — the wizard still drives `/api/namegen` via
// `onGenerate` and advances on `onPickName`. Only JSX + helpers changed.
//
// See plans/anchovy-28942-editorial-restyle.md for the foundation work.
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Copy,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { btn } from "../styles";

type Props = {
  // Form data
  topping: string;
  mafiaMovieTitle: string;
  style: "balanced" | "serious" | "goofy";
  suggestions?: string[];
  resolvedMovieTitle?: string;
  releaseDate?: string;
  mediaType?: "movie" | "tv";
  seenNames: string[];
  mafiaName?: string;

  // For keep-name options
  isUpdate?: boolean;
  existingName?: string;
  discordNick?: string;

  // State
  submitting: boolean;

  // Callbacks
  onChange: (updates: {
    topping?: string;
    mafiaMovieTitle?: string;
    style?: "balanced" | "serious" | "goofy";
  }) => void;
  onGenerate: (force: boolean) => void;
  onPickName: (name: string) => void;
  onKeepExisting: () => void;
  onBack: () => void;
};

/* ──────────────────────────────────────────────────────────────────────────
   Personality + topping flavor (visual only — no behavioral effect)
   ────────────────────────────────────────────────────────────────────────── */

type Persona = {
  margin: string;
  fileNo: string;
  rotation: number;
  yOffset: string;
};

const CARD_PERSONALITIES: Persona[] = [
  { margin: "trusted",     fileNo: "01", rotation: -1.2, yOffset: "lg:translate-y-0" },
  { margin: "dangerous",   fileNo: "02", rotation:  0.9, yOffset: "lg:translate-y-6" },
  { margin: "real earner", fileNo: "03", rotation: -0.6, yOffset: "lg:translate-y-2" },
];

const TOPPING_DESCRIPTOR: Record<string, string> = {
  Pepperoni: "loud · classic · respected",
  Mushroom: "earthy · quiet · dangerous",
  Basil: "green · honest · sicilian",
  Mozzarella: "soft · loyal · everywhere",
  Anchovy: "salty · brutal · old-school",
  Sausage: "heavy · brooklyn · proud",
  "Hot honey": "sweet · chaotic · respected",
  Ricotta: "creamy · gentle · holy",
  Garlic: "sharp · unforgettable · armed",
  Onion: "tearful · loyal · stubborn",
  Olives: "bitter · sicilian · patient",
  Prosciutto: "elegant · cured · expensive",
  Pineapple: "controversial · sunlit · brave",
  "Jalapeño": "hot · quick · unpredictable",
  "Banana peppers": "tangy · cheerful · sneaky",
  Soppressata: "spicy · cured · feared",
  Meatball: "round · familiar · violent",
  "Roasted red pepper": "sweet · smoky · charming",
  Truffle: "rare · expensive · whispered",
  Artichoke: "armored · roman · stubborn",
  Eggplant: "deep · sicilian · velvet",
  "Broccoli rabe": "bitter · green · honest",
  "Chili crisp": "loud · oily · modern",
  Burrata: "soft · luxurious · creamy",
  Oregano: "dry · grandmotherly · sicilian",
  Parmesan: "sharp · aged · proud",
  Tomato: "red · the beginning · everything",
  "Spicy salami": "hot · cured · dangerous",
};

function toppingDescriptor(t: string): string {
  // Case-insensitive match against the canonical key
  const key = Object.keys(TOPPING_DESCRIPTOR).find(
    (k) => k.toLowerCase() === t.trim().toLowerCase(),
  );
  return (key && TOPPING_DESCRIPTOR[key]) || "off-canon · your call · respected";
}

const CYCLE_POOL = [
  "the Quiet", "the Hand", "the Oven", "Two Knives", "the Sicilian",
  "the Patient", "the Whisper", "the Last Call", "the Ledger", "Hot Sauce",
  "the Sunday", "the Vow", "the Velvet", "the Crumb", "Cold Slice",
  "Vito the Pepperoni", "Sal Mozzarella", "Tony Anchovy", "Don Basilio",
  "Frankie the Hot Honey", "Joey Ricotta", "Lou the Sausage", "Carmine Garlic",
  "Angelo the Truffle", "Big Vinnie", "Sonny Soppressata", "the Pepperoni",
  "the Patient One", "the Saucemaker", "Quiet Tony", "the Wednesday Man",
];

const REGEN_LABEL = (attempts: number) =>
  attempts <= 1
    ? "Re-cast"
    : attempts === 2
      ? "Look deeper"
      : "Pull another file";

const CYCLE_OVERLINE = (attempts: number) =>
  attempts <= 1
    ? "The family is deliberating"
    : attempts === 2
      ? "Looking deeper…"
      : attempts === 3
        ? "Pulling another file…"
        : "Found something stranger…";

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────── */

const SPOTLIGHT_HERO: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.25), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

const SPOTLIGHT_REVEAL: CSSProperties = {
  background:
    "radial-gradient(50% 60% at 50% 30%, hsl(46 100% 62% / 0.35), transparent 70%), radial-gradient(60% 50% at 50% 90%, hsl(0 93% 60% / 0.12), transparent 70%)",
};

const SPOTLIGHT_DOCK: CSSProperties = {
  background:
    "radial-gradient(60% 80% at 20% 0%, hsl(46 100% 62% / 0.18), transparent 70%), radial-gradient(60% 80% at 100% 100%, hsl(0 93% 60% / 0.18), transparent 70%)",
};

const CARD_PAPER_GRADIENT: CSSProperties = {
  backgroundImage:
    "radial-gradient(120% 80% at 0% 0%, hsl(40 35% 92% / 0.6), transparent 55%), radial-gradient(120% 80% at 100% 100%, hsl(28 30% 80% / 0.25), transparent 55%)",
};

function initialsOf(name: string): string {
  return (
    name
      .replace(/["'"]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   NameStep
   ────────────────────────────────────────────────────────────────────────── */

export function NameStep({
  topping,
  mafiaMovieTitle,
  style: _style,
  suggestions,
  resolvedMovieTitle,
  releaseDate,
  mediaType,
  seenNames,
  mafiaName: _mafiaName,
  isUpdate,
  existingName,
  discordNick,
  submitting,
  onChange,
  onGenerate,
  onPickName,
  onKeepExisting,
  onBack,
}: Props) {
  /* Local-only UI state. Selection & inline editing live here because they
     don't need to persist past this step — the wizard advances as soon as
     onPickName fires. */
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedName, setEditedName] = useState<string>("");
  const [cycleTick, setCycleTick] = useState(0);

  // Track regenerate attempts purely for the escalating overline copy.
  const attemptsRef = useRef(0);

  // Cycling animation while loading
  useEffect(() => {
    if (!submitting) return;
    const id = window.setInterval(() => setCycleTick((t) => t + 1), 80);
    return () => window.clearInterval(id);
  }, [submitting]);

  // Reset local UI state whenever a fresh batch of suggestions arrives.
  useEffect(() => {
    setSelectedIdx(null);
    setEditing(false);
    setEditedName("");
  }, [suggestions]);

  const canGenerate =
    topping.trim().length > 0 && mafiaMovieTitle.trim().length > 0;

  const showKeepExisting = Boolean(isUpdate && existingName);
  const showKeepDiscord = Boolean(
    !isUpdate && discordNick && (_mafiaName === discordNick || !_mafiaName),
  );

  const topThree = useMemo(
    () => (suggestions ?? []).slice(0, 3),
    [suggestions],
  );

  const finalName =
    selectedIdx === null
      ? ""
      : editing
        ? editedName
        : (topThree[selectedIdx] ?? "");

  const handleGenerate = (force: boolean) => {
    attemptsRef.current += 1;
    onGenerate(force);
  };

  const handleClaim = () => {
    const name = finalName.trim();
    if (!name) return;
    onPickName(name);
  };

  const copyName = async () => {
    if (!finalName) return;
    try {
      await navigator.clipboard.writeText(finalName);
    } catch {
      /* clipboard unsupported — silent */
    }
  };

  return (
    <div className="relative grid gap-12 fade-up">
      {/* ─── Hero spotlight backdrop ─────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
        style={SPOTLIGHT_HERO}
      />

      {/* ─── Keep-existing affordances (our flow, restyled) ──────── */}
      {showKeepExisting && (
        <KeepBlock
          eyebrow="§ 00 · You're already made"
          headline="Keep your current name?"
          name={existingName ?? ""}
          ctaLabel="Keep it and continue"
          onKeep={onKeepExisting}
        />
      )}
      {showKeepDiscord && (
        <KeepBlock
          eyebrow="§ 00 · Discord nickname found"
          headline="Use your Discord name?"
          name={discordNick ?? ""}
          ctaLabel="Use it and continue"
          onKeep={onKeepExisting}
        />
      )}
      {(showKeepExisting || showKeepDiscord) && (
        <p className="ui text-center text-[11px] uppercase tracking-[0.28em] text-foreground/45">
          — or generate a new name instead —
        </p>
      )}

      {/* ─── Hero — shown until suggestions arrive ───────────────── */}
      {!suggestions && !submitting && (
        <header className="relative">
          <p className="overline text-tomato">§ 01 · PizzaDAO</p>
          <h1
            className="font-[family-name:var(--font-display)] mt-4 max-w-[14ch] font-black tracking-[-0.015em] text-foreground"
            style={{
              fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
              lineHeight: 0.9,
              textWrap: "balance",
            }}
          >
            Claim your <span className="text-tomato">mafia name.</span>
          </h1>
          <p
            className="mt-5 max-w-xl text-foreground/75"
            style={{ fontSize: "17px", lineHeight: 1.55 }}
          >
            Choose a topping. Choose a movie. The family handles the rest.
          </p>
        </header>
      )}

      {/* ─── Input phase — shown until suggestions arrive ────────── */}
      {!suggestions && (
        <section className="grid gap-10">
          <CinematicInput
            label="§ 02 · Your topping"
            placeholder="What's your topping?"
            value={topping}
            onChange={(v) => onChange({ topping: v })}
            size="large"
            footer={
              topping.trim() && (
                <p className="ui mt-3 text-[10px] uppercase tracking-[0.24em] text-foreground/45">
                  {toppingDescriptor(topping)}
                </p>
              )
            }
          />

          <CinematicInput
            label="§ 03 · Your mafia movie"
            placeholder="Goodfellas, The Sopranos…"
            value={mafiaMovieTitle}
            onChange={(v) => onChange({ mafiaMovieTitle: v })}
            size="small"
            footer={
              <p className="ui mt-3 text-[10px] uppercase tracking-[0.24em] text-foreground/40">
                Tone reference only — flavors the cadence of your name.
              </p>
            }
          />

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={!canGenerate || submitting}
              className="btn-pill-lg group"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              {submitting ? "Generating…" : "Generate 3 names"}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>

            {resolvedMovieTitle && (
              <span className="ui text-[12px] uppercase tracking-[0.22em] text-foreground/55">
                Matched ·{" "}
                <b className="text-foreground">{resolvedMovieTitle}</b>
                {releaseDate ? ` (${releaseDate.slice(0, 4)})` : ""}
                {mediaType === "tv" ? " · TV" : ""}
              </span>
            )}
          </div>

          {seenNames.length > 0 && (
            <p className="ui text-[11px] uppercase tracking-[0.22em] text-foreground/45">
              Seen this session ·{" "}
              <b className="text-foreground">{seenNames.length}</b>
            </p>
          )}
        </section>
      )}

      {/* ─── Cycling stage ───────────────────────────────────────── */}
      {submitting && (
        <section className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={SPOTLIGHT_REVEAL}
          />
          <CyclingStage tick={cycleTick} attempt={attemptsRef.current} />
        </section>
      )}

      {/* ─── Reveal stage ────────────────────────────────────────── */}
      {!submitting && topThree.length > 0 && (
        <section className="relative">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={onBack}
              className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
            >
              <ArrowLeft className="h-3 w-3" />
              {isUpdate ? "Cancel" : "Change inputs"}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(true)}
              disabled={submitting}
              className="ui inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.22em] text-foreground/65 transition-colors hover:text-tomato disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${submitting ? "animate-spin" : ""}`}
              />
              {REGEN_LABEL(attemptsRef.current)}
            </button>
          </div>

          <div className="mt-10 text-center md:mt-14">
            <p className="overline text-tomato">§ 04 · The naming</p>
            <h2
              className="font-[family-name:var(--font-display)] mx-auto mt-4 max-w-3xl font-black tracking-[-0.01em] text-foreground"
              style={{
                fontSize: "clamp(2rem, 5vw, 3.5rem)",
                lineHeight: 0.95,
              }}
            >
              The pizza has spoken.
            </h2>
            <p className="ui mt-4 text-[12px] uppercase tracking-[0.28em] text-foreground/45">
              One of these belongs to you.
            </p>
          </div>

          <div className="relative mt-12 md:mt-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={SPOTLIGHT_REVEAL}
            />
            <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-3 lg:gap-6 xl:gap-8">
              {topThree.map((name, i) => (
                <FamilyFileCard
                  key={name}
                  name={name}
                  persona={CARD_PERSONALITIES[i]!}
                  topping={topping}
                  isSelected={selectedIdx === i}
                  anySelected={selectedIdx !== null}
                  onSelect={() => {
                    setSelectedIdx(i);
                    setEditedName(name);
                    setEditing(false);
                  }}
                />
              ))}
            </div>
          </div>

          <p className="ui mt-10 text-center text-[11px] uppercase tracking-[0.24em] text-foreground/45">
            Tap a card to claim it.
          </p>
        </section>
      )}

      {/* ─── Empty state ─────────────────────────────────────────── */}
      {!submitting && suggestions && topThree.length === 0 && (
        <div
          className="grain rounded-3xl border border-border bg-card p-8 text-center"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          <p className="text-foreground/70">
            The kitchen's quiet. Try re-casting.
          </p>
        </div>
      )}

      {/* ─── Back link (always visible) ──────────────────────────── */}
      <div className="flex">
        <button
          type="button"
          onClick={onBack}
          style={btn("secondary")}
        >
          {isUpdate ? "Cancel" : "Back"}
        </button>
      </div>

      {/* ─── Sticky selection dock ───────────────────────────────── */}
      {selectedIdx !== null && (
        <div
          className={`sticky bottom-4 z-30 mx-auto w-full max-w-3xl transition-all duration-500 ${
            selectedIdx !== null && !submitting
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-6 opacity-0"
          }`}
        >
          <div
            className="relative overflow-hidden rounded-[28px] border px-6 py-5 md:px-8"
            style={{
              background: "hsl(var(--ink) / 0.96)",
              color: "hsl(var(--cream))",
              borderColor: "hsl(var(--cream) / 0.15)",
              boxShadow:
                "0 30px 60px -30px hsl(0 93% 60% / 0.45), var(--shadow-lifted)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-80"
              style={SPOTLIGHT_DOCK}
            />
            <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p
                  className="overline"
                  style={{ color: "hsl(var(--butter))" }}
                >
                  Your name, your call
                </p>
                {editing ? (
                  <input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    maxLength={120}
                    autoFocus
                    className="font-[family-name:var(--font-display)] mt-2 w-full rounded-xl bg-transparent px-3 py-2 font-black leading-tight tracking-tight focus:outline-none"
                    style={{
                      border: "1px solid hsl(var(--cream) / 0.25)",
                      color: "hsl(var(--cream))",
                      fontSize: "clamp(1.3rem, 2.2vw, 1.8rem)",
                    }}
                  />
                ) : (
                  <h3
                    className="font-[family-name:var(--font-display)] mt-2 truncate font-black leading-tight tracking-tight"
                    style={{ fontSize: "clamp(1.4rem, 2.6vw, 2.1rem)" }}
                  >
                    {finalName}
                  </h3>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (editing) {
                      setEditing(false);
                    } else {
                      setEditing(true);
                      if (selectedIdx !== null) {
                        setEditedName(topThree[selectedIdx] ?? "");
                      }
                    }
                  }}
                  className="ui rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition-colors"
                  style={{
                    border: "1px solid hsl(var(--cream) / 0.22)",
                    color: "hsl(var(--cream))",
                  }}
                >
                  {editing ? "Done" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={copyName}
                  className="ui inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition-colors"
                  style={{
                    border: "1px solid hsl(var(--cream) / 0.22)",
                    color: "hsl(var(--cream))",
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={!finalName.trim()}
                  className="btn-pill group"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                  }}
                >
                  Claim this name
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIdx(null)}
                  aria-label="Dismiss selection"
                  className="ui inline-flex items-center justify-center rounded-full p-2 transition-colors"
                  style={{
                    border: "1px solid hsl(var(--cream) / 0.18)",
                    color: "hsl(var(--cream) / 0.7)",
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────── */

function KeepBlock({
  eyebrow,
  headline,
  name,
  ctaLabel,
  onKeep,
}: {
  eyebrow: string;
  headline: string;
  name: string;
  ctaLabel: string;
  onKeep: () => void;
}) {
  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-8"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <p className="overline relative text-tomato">{eyebrow}</p>
      <h3
        className="font-[family-name:var(--font-display)] relative mt-3 font-black tracking-[-0.01em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3.2vw, 2.2rem)", lineHeight: 1 }}
      >
        {headline}
      </h3>
      <p
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-tight text-foreground"
        style={{ fontSize: "clamp(1.1rem, 2vw, 1.6rem)" }}
      >
        &ldquo;{name}&rdquo;
      </p>
      <div className="relative mt-5">
        <button
          type="button"
          onClick={onKeep}
          className="btn-pill group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
          }}
        >
          {ctaLabel}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function CinematicInput({
  label,
  placeholder,
  value,
  onChange,
  size,
  footer,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  size: "large" | "small";
  footer?: React.ReactNode;
}) {
  const inputClass =
    size === "small"
      ? "font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
      : "font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none";
  const inputStyle: CSSProperties =
    size === "small"
      ? {
          fontSize: "clamp(1.05rem, 2.2vw, 1.6rem)",
          color: "hsl(var(--foreground))",
        }
      : {
          fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)",
          color: "hsl(var(--foreground))",
        };
  const padClass =
    size === "small"
      ? "relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-6 md:py-4"
      : "relative flex items-center gap-4 px-5 py-5 md:gap-6 md:px-8 md:py-7";

  return (
    <div className="relative">
      <p className="overline text-tomato">{label}</p>
      <div
        className="relative mt-4 overflow-hidden rounded-[28px] transition-shadow"
        style={{
          background: "hsl(var(--cream))",
          border: "1px solid hsl(var(--rule-warm) / 0.6)",
          boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(120% 80% at 0% 0%, hsl(46 100% 62% / 0.14), transparent 60%), radial-gradient(80% 60% at 100% 100%, hsl(0 93% 60% / 0.06), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <label className={padClass}>
          <Sparkles
            className={
              size === "small"
                ? "h-4 w-4 shrink-0 text-foreground/35 md:h-5 md:w-5"
                : "h-5 w-5 shrink-0 text-foreground/35 md:h-6 md:w-6"
            }
            aria-hidden
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={inputClass}
            style={inputStyle}
            aria-label={label.replace(/^§ \d+ · /, "")}
          />
        </label>
      </div>
      {footer}
    </div>
  );
}

function CyclingStage({ tick, attempt }: { tick: number; attempt: number }) {
  const current = CYCLE_POOL[tick % CYCLE_POOL.length];
  const NOTES = [
    "nah",
    "too obvious",
    "watch this guy",
    "capo material",
    "this one?",
    "earner",
    "skip it",
  ];
  const note = NOTES[Math.floor(tick / 6) % NOTES.length];
  const crossed = CYCLE_POOL[(tick + 3) % CYCLE_POOL.length];
  const crossed2 = CYCLE_POOL[(tick + 7) % CYCLE_POOL.length];

  return (
    <div className="relative grid place-items-center py-20 md:py-28">
      <p className="overline text-tomato/80">{CYCLE_OVERLINE(attempt)}</p>

      <span className="handwritten pointer-events-none absolute left-[8%] top-[18%] hidden rotate-[-8deg] text-[18px] text-foreground/55 md:block">
        <span className="relative">
          {crossed}
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-[2px] w-full"
            style={{ background: "hsl(var(--tomato) / 0.8)" }}
          />
        </span>
      </span>
      <span className="handwritten pointer-events-none absolute right-[10%] top-[28%] hidden rotate-[6deg] text-[16px] text-foreground/45 md:block">
        <span className="relative">
          {crossed2}
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-[2px] w-full"
            style={{ background: "hsl(var(--tomato) / 0.7)" }}
          />
        </span>
      </span>
      <span className="handwritten pointer-events-none absolute right-[14%] bottom-[20%] hidden rotate-[-4deg] text-[20px] text-tomato md:block">
        {note}
      </span>

      <div
        className="mt-6 overflow-hidden"
        style={{ height: "clamp(3rem, 7vw, 5.5rem)" }}
      >
        <div
          key={tick}
          className="cycle-in font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground/85"
          style={{
            fontSize: "clamp(2rem, 6vw, 5rem)",
            lineHeight: 0.95,
            filter: "blur(0.4px)",
          }}
        >
          {current}
        </div>
      </div>
      <div className="mt-6 flex gap-1.5">
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: "hsl(var(--tomato))" }}
        />
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{
            background: "hsl(var(--tomato))",
            animationDelay: "120ms",
          }}
        />
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{
            background: "hsl(var(--tomato))",
            animationDelay: "240ms",
          }}
        />
      </div>
    </div>
  );
}

function FamilyFileCard({
  name,
  persona,
  topping,
  isSelected,
  anySelected,
  onSelect,
}: {
  name: string;
  persona: Persona;
  topping: string;
  isSelected: boolean;
  anySelected: boolean;
  onSelect: () => void;
}) {
  const dimmed = anySelected && !isSelected;
  const initials = initialsOf(name);
  const flavor = topping.trim() ? toppingDescriptor(topping) : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      style={{
        transform: `rotate(${isSelected ? 0 : persona.rotation}deg)`,
        background: "hsl(var(--cream))",
        borderColor: isSelected
          ? "hsl(var(--tomato) / 0.7)"
          : "hsl(var(--rule-warm) / 0.55)",
        boxShadow: isSelected
          ? "0 36px 70px -28px hsl(0 93% 60% / 0.55)"
          : "var(--shadow-soft)",
        opacity: dimmed ? 0.9 : 1,
      }}
      className={`group relative flex flex-col rounded-[20px] border p-4 pt-5 text-left transition-all duration-500 md:p-5 md:pt-6 ${persona.yOffset} ${
        isSelected ? "-translate-y-2 z-10" : "hover:-translate-y-1.5 hover:rotate-0"
      }`}
    >
      <span
        aria-hidden
        className="grain pointer-events-none absolute inset-0 rounded-[20px] opacity-40"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px]"
        style={CARD_PAPER_GRADIENT}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px]"
        style={{
          boxShadow:
            "inset 0 0 0 1px hsl(28 25% 18% / 0.04), inset 0 -22px 32px -28px hsl(28 30% 18% / 0.22)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] transition-opacity duration-500"
        style={{
          opacity: isSelected ? 1 : 0,
          background:
            "radial-gradient(70% 55% at 50% 0%, hsl(46 100% 62% / 0.14), transparent 70%)",
        }}
      />

      <div className="relative">
        <p className="ui text-[10px] uppercase tracking-[0.28em] text-foreground/50">
          § Family file no. {persona.fileNo}
        </p>
      </div>

      <div className="relative mt-4 flex items-center gap-3">
        <span
          aria-hidden
          className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
          style={{
            border: "1.5px dashed hsl(var(--foreground) / 0.35)",
            background: "hsl(var(--cream) / 0.6)",
            color: "hsl(var(--foreground) / 0.7)",
            transform: "rotate(-4deg)",
          }}
        >
          <span
            aria-hidden
            className="grain pointer-events-none absolute inset-0 rounded-full opacity-40"
          />
          <span className="font-[family-name:var(--font-display)] relative text-[18px] font-black tracking-tight">
            {initials}
          </span>
        </span>
        <span
          className="h-px flex-1"
          style={{ background: "hsl(var(--foreground) / 0.1)" }}
        />
      </div>

      <h3
        className="font-[family-name:var(--font-display)] relative mt-4 font-black tracking-[-0.01em] text-foreground"
        style={{
          fontSize: "clamp(1.35rem, 1.6vw, 1.85rem)",
          lineHeight: 1.05,
          textWrap: "balance",
        }}
      >
        {name}
        <span
          aria-hidden
          className="absolute -bottom-1 left-0 h-[3px] transition-all duration-500"
          style={{
            background: "hsl(var(--tomato))",
            width: isSelected ? "72%" : "0%",
            opacity: isSelected ? 1 : 0,
            borderRadius: 2,
          }}
        />
      </h3>

      {flavor && (
        <p className="ui relative mt-3 text-[10px] uppercase tracking-[0.22em] text-foreground/55">
          {flavor}
        </p>
      )}

      <span
        aria-hidden
        className="handwritten pointer-events-none absolute -bottom-3 right-5 rotate-[-6deg] transition-all duration-500"
        style={{
          fontSize: "17px",
          color: isSelected ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.45)",
          opacity: isSelected ? 1 : 0.8,
        }}
      >
        {persona.margin}
      </span>
    </button>
  );
}
