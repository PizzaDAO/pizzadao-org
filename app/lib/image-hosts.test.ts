import { describe, expect, it } from "vitest";
import { isOptimizableImage } from "./image-hosts";

describe("isOptimizableImage", () => {
  it("accepts local paths", () => {
    expect(isOptimizableImage("/pfp/5.jpg")).toBe(true);
    expect(isOptimizableImage("/turtles/leonardo.png")).toBe(true);
  });

  it("accepts allow-listed remote hosts", () => {
    expect(isOptimizableImage("https://assets.poap.xyz/abc.png")).toBe(true);
    expect(isOptimizableImage("https://v4kqlmewgn6yxzgq.public.blob.vercel-storage.com/a/b.png")).toBe(true);
    expect(isOptimizableImage("https://res.cloudinary.com/alchemyapi/image/upload/x.png")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isOptimizableImage(undefined)).toBe(false);
    expect(isOptimizableImage("")).toBe(false);
    expect(isOptimizableImage("//evil.com/x.png")).toBe(false);
    expect(isOptimizableImage("http://assets.poap.xyz/abc.png")).toBe(false);
    expect(isOptimizableImage("https://example.com/x.png")).toBe(false);
    expect(isOptimizableImage("https://res.cloudinary.com/other/x.png")).toBe(false);
    expect(isOptimizableImage("https://a.b.public.blob.vercel-storage.com/x.png")).toBe(false);
    expect(isOptimizableImage("data:image/png;base64,AAAA")).toBe(false);
  });
});
