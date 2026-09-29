// app/ui/print/HowToPrint.tsx
//
// garlic-67660 — Short, practical print guidance for /print.

const TIPS: { label: string; body: string }[] = [
  {
    label: "Print at 100%",
    body: "In the print dialog choose “Actual size” / 100% scale — not “Fit to page”. Turn on “Print borderless” if your printer has it.",
  },
  {
    label: "Flyers",
    body: "Heavy matte or silk paper, 150–200 gsm (80–100 lb text). Letter or A4 for handouts; 12 × 12 in or A3 at a print shop for posters.",
  },
  {
    label: "Stickers",
    body: "Printable matte vinyl or glossy sticker paper for home printers. For die-cut runs, send the SVG to a sticker shop and ask for a white border.",
  },
  {
    label: "Sharpness",
    body: "Each file lists its largest size at 300 dpi. Going bigger than that is fine for posters viewed from a distance, but stickers will look soft.",
  },
  {
    label: "Color",
    body: "Files are RGB. Tomato red can shift on some printers — do one test sheet before printing a stack.",
  },
];

export function HowToPrint() {
  return (
    <section
      id="how-to-print"
      aria-labelledby="how-to-print-heading"
      className="paper-soft halftone-soft rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] bg-card p-5 sm:p-7 print:break-inside-avoid"
    >
      <p className="overline text-tomato m-0">
        <span aria-hidden>§</span>
        <span aria-hidden className="mx-2 opacity-50">···</span>
        Before you hit print
      </p>
      <h2
        id="how-to-print-heading"
        className="mt-2 mb-0 font-display font-black leading-none tracking-[-0.015em] text-foreground"
        style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}
      >
        How to print
      </h2>
      <dl className="mt-5 mb-0 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {TIPS.map((t) => (
          <div key={t.label} className="rule-warm pt-3">
            <dt className="font-display text-base font-bold text-foreground">{t.label}</dt>
            <dd className="m-0 mt-1 text-sm leading-relaxed text-foreground/75">{t.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
