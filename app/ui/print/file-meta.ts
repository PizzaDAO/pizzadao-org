// app/ui/print/file-meta.ts
//
// garlic-67660 — Server-only helpers that read file type, pixel dimensions and
// byte size for the /print catalog straight from /public. The /print route is
// statically rendered, so this runs once at build time; no image library is
// needed — PNG / JPEG / SVG headers are parsed directly.

import { readFile } from "node:fs/promises";
import path from "node:path";

export type FileKind = "PNG" | "JPG" | "SVG";

export type AssetFileMeta = {
  /** Public URL path, e.g. "/brand-kit/benny-peek.png". */
  src: string;
  fileName: string;
  kind: FileKind;
  width: number | null;
  height: number | null;
  bytes: number;
};

const PUBLIC_DIR = path.join(process.cwd(), "public");

function kindFromPath(p: string): FileKind {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "PNG";
  if (ext === ".jpg" || ext === ".jpeg") return "JPG";
  if (ext === ".svg") return "SVG";
  throw new Error(`Unsupported print asset type: ${p}`);
}

function pngSize(buf: Buffer): [number, number] | null {
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4)
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function jpegSize(buf: Buffer): [number, number] | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    // Standalone markers without a length field
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  return null;
}

function svgSize(buf: Buffer): [number, number] | null {
  const head = buf.toString("utf8", 0, Math.min(buf.length, 4096));
  const tag = head.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const num = (attr: string) => {
    const m = tag.match(new RegExp(`\\s${attr}="([\\d.]+)(px)?"`, "i"));
    return m ? Math.round(parseFloat(m[1])) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return [w, h];
  const vb = tag.match(/viewBox="[\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/i);
  return vb ? [Math.round(parseFloat(vb[1])), Math.round(parseFloat(vb[2]))] : null;
}

export async function readAssetFile(src: string): Promise<AssetFileMeta> {
  const buf = await readFile(path.join(PUBLIC_DIR, src));
  const kind = kindFromPath(src);
  const size = kind === "PNG" ? pngSize(buf) : kind === "JPG" ? jpegSize(buf) : svgSize(buf);
  return {
    src,
    fileName: path.basename(src),
    kind,
    width: size?.[0] ?? null,
    height: size?.[1] ?? null,
    bytes: buf.length,
  };
}

export function readAssetFiles(srcs: string[]): Promise<AssetFileMeta[]> {
  return Promise.all(srcs.map(readAssetFile));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Largest print size at 300 dpi, e.g. `13.7 in / 34.7 cm`. Null for vectors. */
export function maxPrintSize(meta: AssetFileMeta): string | null {
  if (meta.kind === "SVG" || !meta.width || !meta.height) return null;
  const longest = Math.max(meta.width, meta.height) / 300;
  return `${longest.toFixed(1)} in / ${(longest * 2.54).toFixed(1)} cm`;
}
