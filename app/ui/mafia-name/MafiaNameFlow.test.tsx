import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const track = vi.fn();
vi.mock("@/app/lib/activation-client", () => ({ trackActivation: (...a: unknown[]) => track(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type NameStepProps = {
  onGenerate: (force: boolean) => void;
  onPickName: (n: string) => void;
  onChange: (u: { topping?: string; mafiaMovieTitle?: string }) => void;
  suggestions?: string[];
  mode?: string;
};
vi.mock("@/app/ui/onboarding/steps/NameStep", () => ({
  NameStep: (p: NameStepProps) => (
    <div>
      <span data-testid="mode">{p.mode}</span>
      <button onClick={() => p.onChange({ topping: "Pepperoni", mafiaMovieTitle: "The Godfather" })}>inputs</button>
      <button onClick={() => p.onGenerate(false)}>generate</button>
      {(p.suggestions ?? []).map((n) => (
        <button key={n} onClick={() => p.onPickName(n)}>
          pick {n}
        </button>
      ))}
    </div>
  ),
}));
const finale = vi.fn();
vi.mock("@/app/ui/onboarding/FinaleScene", () => ({
  FinaleScene: (p: Record<string, unknown>) => {
    finale(p);
    return (
      <div>
        <a href={String(p.dashboardHref)} onClick={() => (p.onJoin as () => void)()}>
          join
        </a>
        <button onClick={() => (p.onRestart as () => void)()}>restart</button>
      </div>
    );
  },
}));

import { MafiaNameFlow } from "./MafiaNameFlow";

const ORIGIN = { kind: "character", person: "Vito Corleone" };
const namegen = {
  suggestions: ["Pepperoni Corleone", "Don Basil"],
  origins: { "Pepperoni Corleone": ORIGIN },
  sigs: { "Pepperoni Corleone": "sig_1" },
  resolvedMovieTitle: "The Godfather",
  tmdbMovieId: "238",
};

function renderFlow() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MafiaNameFlow />
    </NextIntlClientProvider>,
  );
}

describe("<MafiaNameFlow />", () => {
  beforeEach(() => {
    track.mockReset();
    finale.mockReset();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => namegen }) as Response),
    );
  });

  it("runs name generation without a session, then ends on a public finale with a join link", async () => {
    renderFlow();
    expect(screen.getByTestId("mode").textContent).toBe("public");
    expect(track).toHaveBeenCalledWith("mafia_page", expect.stringMatching(/^sess_/), "viewed");

    fireEvent.click(screen.getByText("inputs"));
    fireEvent.click(screen.getByText("generate"));
    await waitFor(() => screen.getByText("pick Pepperoni Corleone"));
    expect(global.fetch).toHaveBeenCalledWith("/api/namegen", expect.objectContaining({ method: "POST" }));
    expect(track).toHaveBeenCalledWith("mafia_page", expect.any(String), "viewed");
    expect(track).toHaveBeenCalledWith("topping_picked", expect.any(String), "pepperoni");
    expect(track).toHaveBeenCalledWith("film_picked", expect.any(String), "godfather");
    expect(track).toHaveBeenCalledWith("names_generated", expect.any(String), "ok");

    fireEvent.click(screen.getByText("pick Pepperoni Corleone"));
    const props = finale.mock.calls.at(-1)![0];
    expect(props).toMatchObject({
      mode: "public",
      mafiaName: "Pepperoni Corleone",
      topping: "Pepperoni",
      filmId: "godfather",
      originSig: "sig_1",
      origin: { ...ORIGIN, film: "The Godfather" },
    });
    expect(props.actor).toMatch(/^sess_/);
    const href = new URL(props.dashboardHref as string, "http://x");
    expect(href.pathname).toBe("/join");
    expect(href.searchParams.get("from")).toBe("mafia-name");
    expect(href.searchParams.get("name")).toBe("Pepperoni Corleone");
    expect(href.searchParams.get("film")).toBe("godfather");

    fireEvent.click(screen.getByText("join"));
    expect(track).toHaveBeenCalledWith("mafia_page", expect.any(String), "join_clicked");
  });

  it("shares its actor id with the /join wizard's stored session", async () => {
    localStorage.setItem("mob_pizza_onboarding_v3", JSON.stringify({ sessionId: "sess_existing_1" }));
    renderFlow();
    await act(async () => {});
    expect(track).toHaveBeenCalledWith("mafia_page", "sess_existing_1", "viewed");
  });

  it("goes back to picking when the visitor wants another name", async () => {
    renderFlow();
    fireEvent.click(screen.getByText("inputs"));
    fireEvent.click(screen.getByText("generate"));
    await waitFor(() => screen.getByText("pick Don Basil"));
    fireEvent.click(screen.getByText("pick Don Basil"));
    fireEvent.click(screen.getByText("restart"));
    expect(screen.getByText("pick Don Basil")).toBeTruthy();
  });
});
