import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getPublicClaim = vi.fn();

vi.mock("@/app/lib/mafia-claim", () => ({ getPublicClaim: (...a: unknown[]) => getPublicClaim(...a) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  // Echo the key and values so assertions do not depend on copy.
  getTranslations: async () => (key: string, v?: Record<string, string>) =>
    v ? `${key}(${Object.values(v).join("|")})` : key,
}));

import MadePage, { generateMetadata } from "./page";

const claim = {
  id: "abcdefghij",
  name: "Pepperoni Corleone",
  topping: "Pepperoni",
  filmTitle: "The Godfather",
  origin: { kind: "character", person: "Vito Corleone", film: "The Godfather" },
  portraitUrl: "https://blob.example/p.webp",
  createdAt: new Date("2026-10-28T12:00:00Z"),
};
const params = (id = "abcdefghij") => ({ params: Promise.resolve({ id }) });

describe("/made/[id]", () => {
  beforeEach(() => getPublicClaim.mockReset());

  it("404s for an unknown id", async () => {
    getPublicClaim.mockResolvedValue(null);
    await expect(MadePage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPublicClaim).toHaveBeenCalledWith("nope");
  });

  it("renders the certificate with the origin, portrait and a Join the family CTA", async () => {
    getPublicClaim.mockResolvedValue(claim);
    render(await MadePage(params()));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pepperoni Corleone");
    expect(screen.getByText(/originCharacter\(Vito Corleone\|The Godfather\)/)).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("src")).toBe("https://blob.example/p.webp");
    expect(screen.getByRole("link", { name: "ctaButton" }).getAttribute("href")).toBe("/join");
  });

  it("falls back to the topping picture and omits the origin when there is none", async () => {
    getPublicClaim.mockResolvedValue({ ...claim, portraitUrl: null, origin: null });
    const { container } = render(await MadePage(params()));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/toppings/pepperoni.jpg");
    expect(screen.queryByText(/originCharacter/)).toBeNull();
  });

  it("uses the portrait as the share image", async () => {
    getPublicClaim.mockResolvedValue(claim);
    const md = await generateMetadata(params());
    expect(md.openGraph?.images).toEqual([expect.objectContaining({ url: "https://blob.example/p.webp" })]);
    expect(md.twitter).toMatchObject({ card: "summary", images: [expect.objectContaining({ url: "https://blob.example/p.webp" })] });
    expect(md.title).toBe("metaTitle(Pepperoni Corleone)");
    expect(md.robots).toMatchObject({ index: false });
  });

  it("uses the generated topping card when there is no portrait", async () => {
    getPublicClaim.mockResolvedValue({ ...claim, portraitUrl: null });
    const md = await generateMetadata(params());
    expect(md.openGraph?.images).toEqual([expect.objectContaining({ url: "/made/abcdefghij/og", width: 1200, height: 630 })]);
    expect(md.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("exposes no member identifiers", async () => {
    getPublicClaim.mockResolvedValue({ ...claim, discordId: "999888777", realName: "Jane Doe" });
    const { container } = render(await MadePage(params()));
    expect(container.innerHTML).not.toMatch(/999888777|Jane Doe/);
  });
});
