// app/ui/print/AssetCard.tsx
//
// garlic-67660 — One printable asset: thumbnail, per-file specs (type, pixel
// dimensions, file size, max size at 300 dpi) and a direct download link per
// file. Server Component — receives metadata already read from disk.

import Image from "next/image";
import type { PrintAsset } from "./catalog";
import { formatBytes, maxPrintSize, type AssetFileMeta } from "./file-meta";

type Props = {
  asset: PrintAsset;
  files: AssetFileMeta[];
};

// Two-tone checkerboard so transparent PNG edges read as transparent.
const LIGHT_BACKDROP =
  "repeating-conic-gradient(hsl(var(--muted) / 0.55) 0% 25%, hsl(var(--cream)) 0% 50%) 50% / 20px 20px";
const DARK_BACKDROP =
  "repeating-conic-gradient(hsl(var(--ink)) 0% 25%, hsl(var(--ink-soft)) 0% 50%) 50% / 20px 20px";

export function AssetCard({ asset, files }: Props) {
  const thumb = files.find((f) => f.kind !== "SVG") ?? files[0];

  return (
    <article
      id={asset.id}
      className="paper-soft flex flex-col overflow-hidden rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] bg-card print:break-inside-avoid print:shadow-none"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div
        className="relative aspect-square w-full border-b border-[hsl(var(--rule-warm)/0.55)] print:aspect-[4/3]"
        style={{ background: asset.backdrop === "dark" ? DARK_BACKDROP : LIGHT_BACKDROP }}
      >
        <Image
          src={thumb.src}
          alt={asset.title}
          fill
          sizes="(min-width: 1100px) 340px, (min-width: 640px) 45vw, 92vw"
          className="object-contain p-4"
          unoptimized={thumb.kind === "SVG"}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div>
          <h3 className="m-0 font-display text-xl font-bold leading-tight tracking-[-0.01em] text-foreground">
            {asset.title}
          </h3>
          <p className="mt-1 text-sm leading-snug text-foreground/70">{asset.description}</p>
        </div>

        <ul className="mt-auto m-0 flex list-none flex-col gap-2 p-0">
          {files.map((f) => {
            const printSize = maxPrintSize(f);
            return (
              <li
                key={f.src}
                className="rule-warm flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2"
              >
                <dl className="m-0 grid min-w-0 grid-cols-[auto_1fr] gap-x-2 text-xs text-foreground/70">
                  <dt className="overline text-tomato" style={{ fontSize: 10 }}>
                    {f.kind}
                  </dt>
                  <dd className="m-0 tabular-nums">
                    {f.width && f.height ? `${f.width} × ${f.height} px` : "—"}
                    <span aria-hidden className="mx-1.5 opacity-40">·</span>
                    {formatBytes(f.bytes)}
                  </dd>
                  <dt className="sr-only">Print size</dt>
                  <dd className="col-start-2 m-0 text-foreground/55">
                    {printSize ? `Up to ${printSize} at 300 dpi` : "Vector — any size"}
                  </dd>
                </dl>
                <a
                  href={f.src}
                  download={`pizzadao-${f.fileName}`}
                  className="btn-pill min-h-11 border border-foreground/80 bg-transparent px-4 py-2 text-foreground no-underline hover:border-tomato hover:bg-tomato hover:text-cream"
                  data-print-hide
                  aria-label={`Download ${asset.title} (${f.kind})`}
                >
                  Download {f.kind}
                </a>
                <span className="hidden text-xs text-foreground/60 print:inline">{f.src}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}
