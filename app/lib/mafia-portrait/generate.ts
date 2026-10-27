// app/lib/mafia-portrait/generate.ts
// Draws one finale portrait with OpenAI and stores it in Vercel Blob.
import { generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { uploadImageToBlob } from "@/app/lib/blob-image-upload";
import { buildPortraitPrompt, pickAnimal } from "./prompt";

export const DEFAULT_PORTRAIT_MODEL = "gpt-image-1";
export const PORTRAIT_TIMEOUT_MS = 45_000;

/** The provider could not give us an image (timeout, 4xx/5xx, empty result). */
export class PortraitUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PortraitUnavailable";
  }
}

export function portraitModelId(): string {
  return process.env.MAFIA_PORTRAIT_MODEL?.trim() || DEFAULT_PORTRAIT_MODEL;
}

export async function generatePortrait(input: {
  name: string;
  topping: string;
  filmId?: string | null;
}): Promise<{ url: string; animal: string; model: string }> {
  const model = portraitModelId();
  const animal = pickAnimal(input.name, input.topping);
  const prompt = buildPortraitPrompt({ topping: input.topping, filmId: input.filmId, animal });

  let bytes: Uint8Array;
  let mediaType: string;
  try {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  } catch (cause) {
    throw new PortraitUnavailable("Portrait generation failed", { cause });
  }

  try {
    const ext = mediaType.includes("png") ? "png" : "webp";
    const file = new File([bytes as BlobPart], `portrait.${ext}`, { type: mediaType });
    const { url } = await uploadImageToBlob(file, "mafia-portraits");
    return { url, animal, model };
  } catch (cause) {
    throw new PortraitUnavailable("Portrait upload failed", { cause });
  }
}
