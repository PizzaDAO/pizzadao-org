/**
 * Local sample of the AI dress-up (no Blob, no database): redraws a base picture wearing an outfit
 * via the OpenAI image edit API, with the base and the outfit art as references. Same prompt and
 * model fallback as app/lib/pfp-assets/restyle.ts. For judging quality before the feature is on.
 *
 *   OUT_DIR=/path BASE=public/pfp/101.jpg OUTFITS=/path/to/drafts jiti scripts/pfp/restyle-sample.ts 5 7
 *   (each argument is a level: reads outfit-level-<n>.png, writes restyle-sample-<n>.png)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const key = process.env.OPENAI_API_KEY?.trim();
const { OUT_DIR, BASE, OUTFITS } = process.env;
const MODELS = ["gpt-image-1", "gpt-image-1.5"];
const NAMES: Record<string, string> = { "5": "a dark navy suit and tie", "7": "a dark three-piece suit with a gold tie pin" };

async function square(buf: Buffer) {
  return sharp(buf).rotate().resize(1024, 1024, { fit: "cover" }).png().toBuffer();
}

async function main() {
  if (!key || !OUT_DIR || !BASE || !OUTFITS) throw new Error("OPENAI_API_KEY, OUT_DIR, BASE and OUTFITS are required");
  const base = await square(readFileSync(BASE));
  for (const level of process.argv.slice(2)) {
    const outfit = await square(readFileSync(path.join(OUTFITS, `outfit-level-${level}.png`)));
    const prompt =
      `Redraw this exact character, same face, hair, pose, art style, colors and background, but wearing ${NAMES[level] ?? "the outfit"} ` +
      `(see the second image for the outfit). Keep it a square avatar. Remove any text, names or captions from the picture; do not add any text.`;
    for (let i = 0; i < MODELS.length; i++) {
      const form = new FormData();
      form.set("model", MODELS[i]);
      form.set("prompt", prompt);
      form.set("size", "1024x1024");
      form.set("output_format", "png");
      form.set("quality", "medium");
      form.set("input_fidelity", "high");
      form.append("image[]", new File([new Uint8Array(base)], "base.png", { type: "image/png" }));
      form.append("image[]", new File([new Uint8Array(outfit)], "outfit.png", { type: "image/png" }));
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
      if (!res.ok) {
        if (/does not exist/i.test(body.error?.message ?? "") && i + 1 < MODELS.length) continue;
        throw new Error(`level ${level}: HTTP ${res.status} ${body.error?.message ?? ""}`);
      }
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error(`level ${level}: empty result`);
      const file = path.join(OUT_DIR, `restyle-sample-${level}.png`);
      writeFileSync(file, Buffer.from(b64, "base64"));
      console.log(`ok ${level} (${MODELS[i]}) -> ${file}`);
      break;
    }
  }
}
main().catch((e) => { console.error((e as Error).message); process.exit(1); });
