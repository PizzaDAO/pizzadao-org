// app/lib/image-sniff.ts
// Identify an uploaded image by its magic bytes instead of trusting the
// client-supplied File.type. Only raster formats we serve are recognised
// (deliberately no SVG, which can carry script).

export type SniffedImage = {
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  ext: "png" | "jpg" | "gif" | "webp";
};

/** Number of leading bytes sniffImageType needs. */
export const IMAGE_SNIFF_BYTES = 12;

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png" };
  }
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return { mime: "image/gif", ext: "gif" };
  }
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** Read the first bytes of a File/Blob and sniff its image type. */
export async function sniffImageFile(file: Blob): Promise<SniffedImage | null> {
  const head = new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer());
  return sniffImageType(head);
}
