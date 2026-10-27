import { describe, it, expect, vi, beforeEach } from "vitest";

const getPublicClaim = vi.fn();
const imageResponse = vi.fn();

vi.mock("@/app/lib/mafia-claim", () => ({ getPublicClaim: (...a: unknown[]) => getPublicClaim(...a) }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(...args: unknown[]) {
      imageResponse(...args);
      return new Response("png", { headers: { "content-type": "image/png" } });
    }
  },
}));

import { GET } from "./route";

const call = (id: string) => GET(new Request(`https://app.example/made/${id}/og`), { params: Promise.resolve({ id }) });

describe("GET /made/[id]/og", () => {
  beforeEach(() => {
    getPublicClaim.mockReset();
    imageResponse.mockReset();
  });

  it("404s for an unknown id", async () => {
    getPublicClaim.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
    expect(imageResponse).not.toHaveBeenCalled();
  });

  it("renders a 1200x630 card with the name and topping picture", async () => {
    getPublicClaim.mockResolvedValue({ name: "Pepperoni Corleone", topping: "Pepperoni" });
    const res = await call("abcdefghij");
    expect(res.headers.get("content-type")).toBe("image/png");
    const [jsx, opts] = imageResponse.mock.calls[0];
    expect(opts).toMatchObject({ width: 1200, height: 630 });
    const json = JSON.stringify(jsx);
    expect(json).toContain("Pepperoni Corleone");
    expect(json).toContain("https://app.example/toppings/pepperoni.jpg");
  });
});
