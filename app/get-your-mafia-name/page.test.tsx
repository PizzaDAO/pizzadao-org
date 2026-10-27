import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `t:${key}`,
}));
vi.mock("@/app/ui/mafia-name/MafiaNameFlow", () => ({ MafiaNameFlow: () => <div data-testid="flow" /> }));

import Page, { generateMetadata } from "./page";

describe("/get-your-mafia-name", () => {
  it("renders the flow with no session or login involved", async () => {
    render(await Page());
    expect(screen.getByTestId("flow")).toBeTruthy();
    expect(screen.getByText("t:overline")).toBeTruthy();
    expect(screen.getByText("t:footnote")).toBeTruthy();
  });

  it("has indexable, localized metadata with a canonical path and a social card", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe("t:metaTitle");
    expect(meta.description).toBe("t:metaDescription");
    expect(meta.alternates?.canonical).toBe("/get-your-mafia-name");
    expect(meta.robots).toBeUndefined();
    expect(meta.openGraph).toMatchObject({ url: "/get-your-mafia-name", title: "t:metaTitle" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
