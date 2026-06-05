// app/ui/onboarding/steps/ReviewStep.tsx
//
// mozzarella-41832 — Editorial restyle (dossier treatment).
// Visual rewrite modelled on the Lovable mockup's `FinaleScene`. Props,
// callbacks, and submission contract are unchanged — this is purely the
// confirm-or-cancel surface for an update review.
"use client";

import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { CrewOption } from "../types";

type Props = {
  // New values (entered by user)
  mafiaName?: string;
  city: string;
  turtles: string[];
  crews: string[];

  // Existing values (from sheet)
  existingData?: {
    mafiaName?: string;
    city?: string;
    turtles: string[];
    crews: string[];
  };

  // For crew label lookup
  crewOptions: CrewOption[];

  // State
  submitting: boolean;

  // Callbacks
  onSubmit: () => void;
  onCancel: () => void;
};

const VIGNETTE: CSSProperties = {
  background:
    "radial-gradient(70% 60% at 50% 30%, transparent 30%, hsl(20 25% 8% / 0.18) 100%)",
};

const DOSSIER_GRADIENT: CSSProperties = {
  backgroundImage:
    "radial-gradient(120% 70% at 50% 0%, hsl(46 100% 62% / 0.13), transparent 60%), radial-gradient(80% 60% at 100% 100%, hsl(20 40% 25% / 0.08), transparent 70%)",
};

function familyArchiveNo(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const n = (h % 89999) + 10000; // 5-digit
  return String(n);
}

export function ReviewStep({
  mafiaName,
  city,
  turtles,
  crews,
  existingData,
  crewOptions,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const crewLabels = crews
    .map((id) => crewOptions.find((c) => c.id === id)?.label || id)
    .join(", ");
  const existingCrewLabels = (existingData?.crews ?? []).join(", ");

  const fields: { label: string; value: string; old: string }[] = [
    { label: "Name", value: mafiaName || "—", old: existingData?.mafiaName || "—" },
    { label: "City", value: city || "—", old: existingData?.city || "—" },
    {
      label: "Turtles",
      value: turtles.length ? turtles.join(", ") : "—",
      old: existingData?.turtles?.length ? existingData.turtles.join(", ") : "—",
    },
    {
      label: "Crews",
      value: crewLabels || "—",
      old: existingCrewLabels || "—",
    },
  ];

  const archive = familyArchiveNo(
    `${mafiaName ?? ""}|${city}|${turtles.join(",")}|${crews.join(",")}`,
  );

  return (
    <div className="relative grid gap-10 fade-up">
      {/* ─── Vignette ────────────────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={VIGNETTE}
      />

      {/* ─── Ceremony headline ──────────────────────────────────── */}
      <header className="relative text-center">
        <p className="overline text-tomato">§ 06 · The dossier</p>
        <h2
          className="font-[family-name:var(--font-display)] mx-auto mt-4 max-w-[14ch] font-black tracking-[-0.015em] text-foreground"
          style={{
            fontSize: "clamp(2.2rem, 6vw, 4.2rem)",
            lineHeight: 0.95,
            textWrap: "balance",
          }}
        >
          One last <span className="text-tomato">look</span>.
        </h2>
        <p
          className="mx-auto mt-4 max-w-md text-foreground/70"
          style={{ fontSize: "15px", lineHeight: 1.55 }}
        >
          Confirm the file before it goes in the cabinet. Modified fields are
          marked.
        </p>
      </header>

      {/* ─── Dossier paper ──────────────────────────────────────── */}
      <div className="relative">
        <div
          className="relative mx-auto max-w-2xl"
          style={{ transform: "rotate(-0.4deg)" }}
        >
          <div
            className="paper-soft relative overflow-hidden rounded-[18px] border p-5 md:p-7"
            style={{
              background: "hsl(40 38% 94%)",
              borderColor: "hsl(var(--rule-warm) / 0.7)",
              boxShadow:
                "0 50px 90px -40px hsl(20 30% 8% / 0.45), var(--shadow-lifted)",
              ...DOSSIER_GRADIENT,
            }}
          >
            {/* Edge wear */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[18px]"
              style={{
                boxShadow:
                  "inset 0 0 0 1px hsl(28 25% 18% / 0.05), inset 0 -22px 28px -24px hsl(28 30% 18% / 0.25), inset 0 22px 28px -28px hsl(40 35% 95% / 0.6)",
              }}
            />
            {/* Coffee stain */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-6 top-12 h-24 w-24 rounded-full opacity-[0.10]"
              style={{
                background:
                  "radial-gradient(circle, hsl(20 50% 20%) 0%, transparent 70%)",
              }}
            />

            {/* TOP ROW: paperclip + record label + archive # */}
            <div className="relative flex items-center gap-3 pb-2.5">
              <span
                aria-hidden
                className="inline-block h-5 w-3 shrink-0 rounded-full"
                style={{
                  border: "2px solid hsl(var(--foreground) / 0.45)",
                  borderBottomColor: "transparent",
                  transform: "rotate(-12deg)",
                }}
              />
              <p className="ui flex-1 truncate text-[10px] uppercase tracking-[0.32em] text-foreground/55">
                PizzaDAO · Family Record
              </p>
              <p className="ui shrink-0 text-[10px] uppercase tracking-[0.32em] text-foreground/50">
                № {archive}
              </p>
            </div>
            <div
              className="relative h-px"
              style={{ background: "hsl(var(--foreground) / 0.2)" }}
            />

            {/* Big alias display */}
            <div className="relative mt-5 grid gap-1.5">
              <p className="ui text-[9.5px] uppercase tracking-[0.32em] text-tomato">
                Status · Made
              </p>
              <h3
                className="font-[family-name:var(--font-display)] font-black tracking-[-0.015em] text-foreground"
                style={{
                  fontSize: "clamp(1.6rem, 4.4vw, 2.8rem)",
                  lineHeight: 0.95,
                }}
              >
                {mafiaName || "—"}
              </h3>
              <span
                aria-hidden
                className="handwritten mt-1 inline-block rotate-[-3deg] text-[15px] text-tomato"
              >
                approved — Benny
              </span>
            </div>

            {/* Dossier fields grid */}
            <div
              className="relative mt-5 grid grid-cols-2 gap-x-5 gap-y-3 pt-4 md:grid-cols-2"
              style={{ borderTop: "1px solid hsl(var(--foreground) / 0.15)" }}
            >
              {fields.map((f) => {
                const changed =
                  String(f.value).trim().toLowerCase() !==
                  String(f.old).trim().toLowerCase();
                return (
                  <DossierField
                    key={f.label}
                    label={f.label}
                    value={f.value}
                    oldValue={existingData ? f.old : undefined}
                    changed={changed && Boolean(existingData)}
                  />
                );
              })}
            </div>

            {/* Stamped "made" seal */}
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-[55%] z-20 md:right-5 md:top-[34%]"
              style={{ transform: "rotate(-11deg)" }}
            >
              <span
                aria-hidden
                className="absolute inset-0 -m-2 rounded-full"
                style={{ background: "hsl(var(--tomato) / 0.15)" }}
              />
              <span
                className="relative grid h-[68px] w-[68px] place-items-center sm:h-[78px] sm:w-[78px] md:h-[96px] md:w-[96px]"
                style={{
                  color: "hsl(var(--tomato))",
                  backgroundImage:
                    "radial-gradient(60% 60% at 32% 28%, hsl(0 93% 60% / 0.18), transparent 70%), radial-gradient(40% 40% at 75% 75%, hsl(0 93% 40% / 0.12), transparent 70%)",
                  border: "3px solid hsl(0 93% 45% / 0.82)",
                  boxShadow:
                    "inset 0 0 0 2px hsl(0 93% 45% / 0.28), inset 0 6px 14px -6px hsl(0 93% 30% / 0.5), inset 0 -4px 10px -6px hsl(40 35% 95% / 0.35), 0 6px 12px -8px hsl(20 40% 10% / 0.4)",
                  borderRadius: "48% 52% 53% 47% / 51% 48% 52% 49%",
                  filter: "contrast(1.06) saturate(1.04)",
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 grain"
                  style={{
                    borderRadius: "inherit",
                    mixBlendMode: "multiply",
                    opacity: 0.65,
                  }}
                />
                <div className="relative text-center leading-tight">
                  <div className="font-[family-name:var(--font-display)] text-[10px] font-black uppercase tracking-[0.18em] md:text-[11.5px]">
                    Officially
                  </div>
                  <div className="font-[family-name:var(--font-display)] text-[14px] font-black uppercase tracking-[0.14em] md:text-[17px]">
                    Made
                  </div>
                  <div className="ui mt-0.5 text-[7.5px] uppercase tracking-[0.32em] opacity-80">
                    PizzaDAO
                  </div>
                </div>
              </span>
            </span>
          </div>

          {/* Margin scribbles */}
          <span
            aria-hidden
            className="handwritten pointer-events-none absolute -left-2 top-[-18px] hidden rotate-[-6deg] text-[16px] text-foreground/55 md:block"
          >
            file under: {(mafiaName || "—").toLowerCase()}
          </span>
        </div>
      </div>

      {/* ─── Actions ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="btn-pill-lg group"
          style={{
            background: "transparent",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--foreground) / 0.3)",
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Don&apos;t update
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {submitting ? "Updating profile…" : "Yes, update my profile"}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   DossierField — stamped index-card style field display
   ────────────────────────────────────────────────────────────────────────── */

function DossierField({
  label,
  value,
  oldValue,
  changed,
}: {
  label: string;
  value: string;
  oldValue?: string;
  changed: boolean;
}) {
  return (
    <div>
      <p className="ui flex items-center gap-1.5 text-[9px] uppercase tracking-[0.3em] text-foreground/45">
        {label}
        {changed && (
          <span
            aria-hidden
            className="inline-block h-1 w-1 rounded-full"
            style={{ background: "hsl(var(--tomato))" }}
            title="Modified"
          />
        )}
      </p>
      <p
        className={`font-[family-name:var(--font-display)] mt-1.5 leading-tight tracking-tight text-foreground ${
          changed ? "font-black" : "font-bold"
        }`}
        style={{ fontSize: "15px" }}
      >
        {value}
      </p>
      {oldValue && changed && (
        <p className="ui mt-0.5 text-[10px] uppercase tracking-[0.22em] text-foreground/40">
          was · {oldValue}
        </p>
      )}
    </div>
  );
}
