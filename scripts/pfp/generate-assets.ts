/**
 * Generate draft PFP asset layers with the OpenAI Images API (gpt-image-1, transparent PNG, 1024x1024).
 * Drafts only: nothing is uploaded to Blob or the app. Snax reviews the files, then uploads the
 * keepers through /admin/pfp-assets.
 *
 * Usage (OPENAI_API_KEY must be in the environment; never print it):
 *   OUT_DIR=/path/to/drafts jiti scripts/pfp/generate-assets.ts [slug ...]
 *
 * With slugs, only those layers are generated. Existing files are skipped unless FORCE=1.
 * Prompts live in scripts/pfp/prompts.json (a shared style paragraph plus one prompt per layer).
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

interface Layer { slug: string; kind: string; prompt: string }
interface Prompts { style: string; layers: Layer[] }

// gpt-image-1 first; accounts that no longer list it fall through to the next (all support transparency).
const MODELS = process.env.PFP_IMAGE_MODEL?.trim() ? [process.env.PFP_IMAGE_MODEL.trim()] : ["gpt-image-1", "gpt-image-1.5"];
let model = MODELS[0];
const outDir = process.env.OUT_DIR;
const key = process.env.OPENAI_API_KEY?.trim();

async function generate(layer: Layer, style: string): Promise<Buffer> {
  for (let i = MODELS.indexOf(model); ; i++) {
    try {
      return await request(layer, style, MODELS[i]);
    } catch (e) {
      if (/does not exist/i.test((e as Error).message) && i + 1 < MODELS.length) {
        model = MODELS[i + 1];
        console.log(`model ${MODELS[i]} unavailable, using ${model}`);
        continue;
      }
      throw e;
    }
  }
}

async function request(layer: Layer, style: string, modelId: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      prompt: `${layer.prompt}\n\nStyle: ${style}`,
      size: "1024x1024",
      background: layer.kind === "background" ? "opaque" : "transparent",
      output_format: "png",
      quality: "medium",
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error?.message ?? "image request failed"}`);
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("empty image result");
  return Buffer.from(b64, "base64");
}

async function main() {
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  if (!outDir) throw new Error("OUT_DIR is not set");
  const prompts = JSON.parse(readFileSync(path.join(__dirname, "prompts.json"), "utf8")) as Prompts;
  const only = new Set(process.argv.slice(2));
  const layers = prompts.layers.filter((l) => only.size === 0 || only.has(l.slug));
  mkdirSync(outDir, { recursive: true });

  let failed = 0;
  for (const layer of layers) {
    const file = path.join(outDir, `${layer.slug}.png`);
    if (existsSync(file) && process.env.FORCE !== "1") {
      console.log(`skip  ${layer.slug} (exists)`);
      continue;
    }
    try {
      writeFileSync(file, await generate(layer, prompts.style));
      console.log(`ok    ${layer.slug} (${layer.kind}) -> ${file}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${layer.slug}: ${(e as Error).message}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
