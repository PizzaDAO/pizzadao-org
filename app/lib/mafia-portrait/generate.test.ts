import { describe, it, expect, vi, beforeEach } from "vitest";

const generateImage = vi.fn();
const upload = vi.fn();
vi.mock("ai", () => ({ generateImage: (...a: unknown[]) => generateImage(...a) }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ image: (id: string) => ({ id }) }),
}));
const models = vi.fn();
vi.mock("@/app/lib/settings", () => ({ getSetting: (...a: unknown[]) => models(...a) }));
vi.mock("@/app/lib/blob-image-upload", () => ({ uploadImageToBlob: (...a: unknown[]) => upload(...a) }));

import { PortraitUnavailable, generatePortrait } from "./generate";

describe("generatePortrait", () => {
  beforeEach(() => {
    generateImage.mockReset();
    upload.mockReset();
    models.mockReset();
    models.mockResolvedValue(["gpt-image-1.5", "gpt-image-1"]);
    delete process.env.MAFIA_PORTRAIT_MODEL;
  });

  it("draws, uploads under mafia-portraits and returns the url", async () => {
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "https://blob/x.webp" });
    const r = await generatePortrait({ name: "Tony", turtles: ["Leonardo"], crews: ["comms"] });
    expect(r).toMatchObject({ url: "https://blob/x.webp", model: "gpt-image-1.5" });
    const args = generateImage.mock.calls[0][0];
    expect(args.model).toEqual({ id: "gpt-image-1.5" });
    expect(args.size).toBe("1024x1024");
    expect(args.providerOptions.openai).toEqual({ quality: "medium", outputFormat: "webp" });
    expect(args.prompt).toContain('named **"Tony"**');
    expect(args.prompt).toContain("hatband blue");
    expect(args.prompt).toContain("vintage microphone");
    expect(upload.mock.calls[0][1]).toBe("mafia-portraits");
  });

  it("honours MAFIA_PORTRAIT_MODEL", async () => {
    process.env.MAFIA_PORTRAIT_MODEL = "gpt-image-x";
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "u" });
    const r = await generatePortrait({ name: "A" });
    expect(r.model).toBe("gpt-image-x");
  });

  it("tries gpt-image-1.5 first and falls back to gpt-image-1 only when the model does not exist", async () => {
    generateImage
      .mockRejectedValueOnce(new Error("The model 'gpt-image-1.5' does not exist"))
      .mockResolvedValueOnce({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "u" });
    const r = await generatePortrait({ name: "A" });
    expect(generateImage.mock.calls.map((c) => c[0].model.id)).toEqual(["gpt-image-1.5", "gpt-image-1"]);
    expect(r.model).toBe("gpt-image-1");
  });

  it("does not fall back on other errors, and the env override pins one model", async () => {
    generateImage.mockRejectedValue(new Error("rate limited"));
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
    expect(generateImage).toHaveBeenCalledTimes(1);
    generateImage.mockReset();
    process.env.MAFIA_PORTRAIT_MODEL = "gpt-image-x";
    generateImage.mockRejectedValue(new Error("The model 'gpt-image-x' does not exist"));
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it("uses the configured model order", async () => {
    models.mockResolvedValue(["gpt-image-2", "gpt-image-1.5"]);
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockResolvedValue({ url: "u" });
    expect((await generatePortrait({ name: "A" })).model).toBe("gpt-image-2");
  });

  it("throws PortraitUnavailable on provider failure or timeout", async () => {
    generateImage.mockRejectedValue(new Error("boom"));
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
    generateImage.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
  });

  it("throws PortraitUnavailable on an empty image or failed upload", async () => {
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array(), mediaType: "image/webp" } });
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
    generateImage.mockResolvedValue({ image: { uint8Array: new Uint8Array([1]), mediaType: "image/webp" } });
    upload.mockRejectedValue(new Error("blob down"));
    await expect(generatePortrait({ name: "A" })).rejects.toBeInstanceOf(PortraitUnavailable);
  });
});
