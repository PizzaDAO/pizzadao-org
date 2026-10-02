// app/print/page.tsx
//
// garlic-67660 — Print Materials. Public page that gathers every printable
// brand asset (party flyers, Molto Benny stickers, logos) with thumbnails,
// file specs and direct downloads, plus short "how to print" guidance.
//
// Server Component, statically rendered: file type / dimensions / size are
// read from /public at build time (see app/ui/print/file-meta.ts).

import type { Metadata } from "next";
import Link from "next/link";
import { PRINT_CATALOG } from "../ui/print/catalog";
import { readAssetFiles } from "../ui/print/file-meta";
import { AssetCard } from "../ui/print/AssetCard";
import { HowToPrint } from "../ui/print/HowToPrint";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Print Materials",
  description:
    "Download PizzaDAO flyers, Molto Benny stickers and logos, ready to print for your next pizza party.",
};

// Hide site-wide decoration and interactive chrome when the page itself is
// printed. `[data-print-hide]` is used instead of Tailwind's `print:hidden` for
// elements whose unlayered classes (e.g. .btn-pill) set `display` and would
// otherwise win over the layered utility.
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body::before { display: none !important; }
  body { background: #fff !important; }
  [data-print-hide], .suggestion-link, .github-link { display: none !important; }
  section > h2, section > p { break-after: avoid; }
}
`;

export default async function PrintMaterialsPage() {
  const sections = await Promise.all(
    PRINT_CATALOG.map(async (category) => ({
      category,
      assets: await Promise.all(
        category.assets.map(async (asset) => ({
          asset,
          files: await readAssetFiles(asset.files),
        })),
      ),
    })),
  );

  return (
    <main className="relative min-h-screen bg-background print:bg-white px-4 py-10 text-foreground sm:px-5 print:min-h-0 print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto max-w-[1100px]">
        <Link
          href="/"
          className="overline mb-3 inline-flex min-h-11 items-center text-foreground/55 no-underline transition-colors hover:text-tomato print:hidden"
        >
          <span aria-hidden className="mr-2">←</span> Back to home
        </Link>

        <header className="fade-up relative mb-8 print:mb-4">
          <p className="overline m-0 text-tomato">
            <span aria-hidden>§</span>
            <span aria-hidden className="mx-2 opacity-50">···</span>
            The Print Shop
          </p>
          <h1
            className="m-0 mt-3 font-display font-black leading-[0.95] tracking-[-0.015em] text-foreground"
            style={{ fontSize: "clamp(2.6rem, 7vw, 5.2rem)", textWrap: "balance" }}
          >
            Print <span className="underline-scribble text-tomato">Materials</span>
          </h1>
          <p className="mt-4 max-w-xl text-foreground/70" style={{ fontSize: 15, lineHeight: 1.55 }}>
            Flyers, stickers and logos for your pizza party, meetup or laptop lid. Free to
            download — no login needed.
          </p>
          <nav aria-label="Sections" className="mt-5 flex flex-wrap gap-2 print:hidden">
            {[...PRINT_CATALOG.map((c) => ({ id: c.id, label: c.overline })), { id: "how-to-print", label: "How to print" }].map(
              (s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="btn-pill min-h-11 border border-[hsl(var(--rule-warm))] bg-card px-4 py-2 text-foreground no-underline hover:border-tomato hover:text-tomato"
                >
                  {s.label}
                </a>
              ),
            )}
          </nav>
          <div className="rule-thick mt-8" />
          <div className="rule mt-1" />
        </header>

        <div className="flex flex-col gap-14 print:gap-8">
          {sections.map(({ category, assets }) => (
            <section key={category.id} id={category.id} aria-labelledby={`${category.id}-heading`} className="scroll-mt-6">
              <p className="overline m-0 text-tomato">
                <span aria-hidden>§</span>
                <span aria-hidden className="mx-2 opacity-50">···</span>
                {category.overline}
              </p>
              <h2
                id={`${category.id}-heading`}
                className="mt-2 mb-0 font-display font-black leading-none tracking-[-0.015em] text-foreground"
                style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}
              >
                {category.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/70">{category.blurb}</p>
              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
                {assets.map(({ asset, files }) => (
                  <AssetCard key={asset.id} asset={asset} files={files} />
                ))}
              </div>
            </section>
          ))}

          <HowToPrint />
        </div>
      </div>
    </main>
  );
}
