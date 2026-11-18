// app/lib/mafia-portrait/generate.ts
// Draws one finale portrait with OpenAI and stores it in Vercel Blob.
import { generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { uploadImageToBlob } from "@/app/lib/blob-image-upload";
import { isModelMissing, loadImageModels } from "@/app/lib/ai-image-models";
import { buildPortraitPrompt, type PortraitInput } from "./prompt";

export const PORTRAIT_TIMEOUT_MS = 45_000;

/** The provider could not give us an image (timeout, 4xx/5xx, empty result). */
export class PortraitUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PortraitUnavailable";
  }
}

/** MAFIA_PORTRAIT_MODEL pins one model (no fallback); otherwise the ai.imageModels setting, in order. */
export function portraitModelOverride(): string | undefined {
  return process.env.MAFIA_PORTRAIT_MODEL?.trim() || undefined;
}

function errorText(e: unknown): string {
  const x = e as { message?: string; responseBody?: string; data?: { error?: { message?: string } } } | undefined;
  return [x?.message, x?.data?.error?.message, x?.responseBody].filter(Boolean).join(" ");
}

export async function generatePortrait(input: PortraitInput): Promise<{ url: string; model: string }> {
  const override = portraitModelOverride();
  const models = override ? [override] : await loadImageModels();
  const prompt = buildPortraitPrompt(input);

  let bytes: Uint8Array | undefined;
  let mediaType = "image/webp";
  let model = models[0];
  try {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    for (let i = 0; i < models.length; i++) {
      model = models[i];
      try {
        const result = await generateImage({
          model: openai.image(model),
          prompt,
          size: "1024x1024",
          providerOptions: { openai: { quality: "medium", outputFormat: "webp" } },
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(PORTRAIT_TIMEOUT_MS),
        });
        if (!result.image?.uint8Array?.length) throw new Error("empty image");
        bytes = result.image.uint8Array;
        mediaType = result.image.mediaType || "image/webp";
        break;
      } catch (e) {
        // Only "this account has no such model" moves on to the next one; the call never ran.
        if (i + 1 < models.length && isModelMissing(errorText(e))) continue;
        throw e;
      }
    }
    if (!bytes) throw new Error("no image");
  } catch (cause) {
    throw new PortraitUnavailable("Portrait generation failed", { cause });
  }

  try {
    const ext = mediaType.includes("png") ? "png" : "webp";
    const file = new File([bytes as BlobPart], `portrait.${ext}`, { type: mediaType });
    const { url } = await uploadImageToBlob(file, "mafia-portraits");
    return { url, model };
  } catch (cause) {
    throw new PortraitUnavailable("Portrait upload failed", { cause });
  }
}
