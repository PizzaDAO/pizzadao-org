import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Reach from "./Reach";
import citiesData from "@/app/(marketing)/_site/data/pizzadao-cities.json";

// jsdom has no SVG layout (d3-zoom needs it), so the zoom wrapper is a plain group here.
vi.mock("react-simple-maps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-simple-maps")>();
  return { ...actual, ZoomableGroup: ({ children }: { children: React.ReactNode }) => <g>{children}</g> };
});

const CITY_COUNT = (citiesData as unknown[]).length;

const renderReach = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Reach />
    </QueryClientProvider>,
  );

const markerCircles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("circle")).filter((c) => c.getAttribute("fill") !== "transparent");

afterEach(() => vi.unstubAllGlobals());

describe("Reach map levels", () => {
  it.each([
    ["network error", () => vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))],
    ["404 while the switch is off", () => vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ enabled: false }) })],
  ])("renders the plain map when the endpoint fails (%s)", async (_name, makeFetch) => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderReach();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    // Exactly today's markers: one circle each, default radius and colour, no hit circles, no legend.
    const circles = markerCircles(container);
    expect(circles).toHaveLength(CITY_COUNT);
    for (const c of circles) {
      expect(c.getAttribute("r")).toBe("2.6");
      expect(c.getAttribute("fill")).toBe("hsl(0 93% 60%)");
    }
    expect(container.querySelector('circle[fill="transparent"]')).toBeNull();
    expect(screen.queryByLabelText("Map levels")).toBeNull();
  });

  it("shows tier styling and the legend when levels arrive", async () => {
    const body = {
      version: 1,
      generatedAt: "x",
      tiers: [
        { level: 1, name: "Dough" },
        { level: 2, name: "Sauce" },
      ],
      cities: [{ key: "lagos-566", name: "Lagos", country: "NG", level: 2, members: "10+" }],
      countries: [],
    };
    // Only the app endpoint answers; the world-atlas request (jsdelivr) fails, so no countries are drawn.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("/api/public/map-levels")
          ? Promise.resolve({ ok: true, status: 200, json: async () => body })
          : Promise.reject(new TypeError("offline")),
      ),
    );
    const { container } = renderReach();
    expect(await screen.findByLabelText("Map levels")).toBeTruthy();
    expect(screen.getByText("Dough")).toBeTruthy();
    expect(screen.getByText("Sauce")).toBeTruthy();
    const radii = markerCircles(container).map((c) => c.getAttribute("r"));
    expect(radii.filter((r) => r === "5")).toHaveLength(1);
    expect(radii.filter((r) => r === "2.6")).toHaveLength(CITY_COUNT - 1);
  });
});
