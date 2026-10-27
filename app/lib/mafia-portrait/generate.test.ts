import { describe, it, expect, vi, beforeEach } from "vitest";

const generateImage = vi.fn();
const upload = vi.fn();
vi.mock("ai", () => ({ generateImage: (...a: unknown[]) => generateImage(...a) }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ image: (id: string) => ({ id }) }),
}));
vi.mock("@/app/lib/blob-image-upload", () => ({ uploadImageToBlob: (...a: unknown[]) => upload(...a) }));

import { PortraitUnavailable, generatePortrait } from "./generate";

describe("generatePortrait", () => {
  beforeEach(() => {
    generateImage.mockReset();
    upload.mockReset();
    delete process.env.MAFIA_PORTRAIT_MODEL;
  });

  it("draws, uploads under mafia-portraits and returns the url", async () => {
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "https://blob/x.webp" });
    const r = await generatePortrait({ name: "Tony", topping: "Basil", filmId: "godfather" });
    expect(r).toMatchObject({ url: "https://blob/x.webp", model: "gpt-image-1" });
    const args = generateImage.mock.calls[0][0];
    expect(args.model).toEqual({ id: "gpt-image-1" });
    expect(args.size).toBe("1024x1024");
    expect(args.providerOptions.openai).toEqual({ quality: "medium", outputFormat: "webp" });
    expect(args.prompt).not.toContain("Tony");
    expect(upload.mock.calls[0][1]).toBe("mafia-portraits");
  });

  it("honours MAFIA_PORTRAIT_MODEL", async () => {
    process.env.MAFIA_PORTRAIT_MODEL = "gpt-image-x";
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "u" });
    const r = await generatePortrait({ name: "A", topping: "Basil" });
    expect(r.model).toBe("gpt-image-x");
  });

  it("throws PortraitUnavailable on provider failure or timeout", async () => {
    generateImage.mockRejectedValue(new Error("boom"));
    await expect(generatePortrait({ name: "A", topping: "Basil" })).rejects.toBeInstanceOf(PortraitUnavailable);
    generateImage.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(generatePortrait({ name: "A", topping: "Basil" })).rejects.toBeInstanceOf(PortraitUnavailable);
  });

  it("throws PortraitUnavailable on an empty image or failed upload", async () => {
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array(), mediaType: "image/webp" } });
    await expect(generatePortrait({ name: "A", topping: "Basil" })).rejects.toBeInstanceOf(PortraitUnavailable);
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockRejectedValue(new Error("blob down"));
    await expect(generatePortrait({ name: "A", topping: "Basil" })).rejects.toBeInstanceOf(PortraitUnavailable);
  });
});
