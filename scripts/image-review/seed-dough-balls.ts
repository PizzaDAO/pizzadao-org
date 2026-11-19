/**
 * Seed the "dough-ball" capo image-review set: generate N candidates with the shared image-model list
 * (app/lib/ai-image-models.ts, gpt-image-1.5 first), upload each to Vercel Blob under
 * image-review/dough-ball/, and insert the rows with the exact prompt and traits used.
 *
 *   Dry run (no network, no keys):
 *     JITI_ALIAS="{\"@\":\"$PWD\"}" npx jiti scripts/image-review/seed-dough-balls.ts --dry-run [--count 20]
 *   Real run (needs DATABASE_URL, OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN; never print them):
 *     JITI_ALIAS="{\"@\":\"$PWD\"}" npx jiti scripts/image-review/seed-dough-balls.ts [--count 20] [--append]
 *
 * Refuses to run when the set already has candidates unless --append is given (new ones continue the
 * deterministic trait list from the current count). Each candidate is inserted as soon as it is made.
 */
import { buildCandidates } from "./dough-ball-prompts";

const SLUG = "dough-ball";
const TITLE = "Dough ball profile picture";
const DESCRIPTION = "Does this dough-ball recruit fit as the default PizzaDAO profile picture? Vote yes or no and say why.";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function generate(prompt: string, models: string[], isModelMissing: (m: string) => boolean, key: string): Promise<Buffer> {
  let lastErr: Error | null = null;
  for (const model of models) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size: "1024x1024", output_format: "png", quality: "medium", n: 1 }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (res.ok) {
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error("empty image result");
      return Buffer.from(b64, "base64");
    }
    lastErr = new Error(`HTTP ${res.status}: ${body.error?.message ?? "image request failed"}`);
    if (!isModelMissing(body.error?.message ?? "")) throw lastErr;
    console.log(`model ${model} unavailable, trying the next`);
  }
  throw lastErr ?? new Error("no image models configured");
}

async function main() {
  const count = Number(argValue("--count") ?? 20);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("--count must be 1-100");

  if (process.argv.includes("--dry-run")) {
    for (const c of buildCandidates(count)) {
      console.log(`#${c.position + 1} ${JSON.stringify(c.traits)}\n${c.prompt}\n`);
    }
    console.log(`(dry run: ${count} prompts, nothing generated or written)`);
    return;
  }

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const { put } = await import("@vercel/blob");
  const { prisma } = await import("../../app/lib/db");
  const { loadImageModels, isModelMissing } = await import("../../app/lib/ai-image-models");

  const set = await prisma.imageReviewSet.upsert({
    where: { slug: SLUG },
    create: { slug: SLUG, title: TITLE, description: DESCRIPTION },
    update: {},
  });
  const existing = await prisma.imageReviewCandidate.count({ where: { setId: set.id } });
  if (existing > 0 && !process.argv.includes("--append")) {
    throw new Error(`Set already has ${existing} candidates; pass --append to add more`);
  }
  const models = await loadImageModels();
  console.log(`models: ${models.join(", ")}`);

  let failed = 0;
  for (const c of buildCandidates(count, existing)) {
    try {
      const png = await generate(c.prompt, models, isModelMissing, key);
      const blob = await put(`image-review/${SLUG}/${c.position + 1}.png`, png, {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/png",
      });
      await prisma.imageReviewCandidate.create({
        data: { setId: set.id, imageUrl: blob.url, prompt: c.prompt, traits: c.traits, position: c.position },
      });
      console.log(`ok    #${c.position + 1} ${blob.url}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  #${c.position + 1}: ${(e as Error).message}`);
    }
  }
  console.log(`done, ${count - failed} of ${count} created`);
  if (failed) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error((e as Error).message);
    process.exit(1);
  },
);
