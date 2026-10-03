import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CrimeCard } from "../CrimeCard";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("CrimeCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the payout and tells the page to refresh the wallet", async () => {
    const fetchFn = mockFetch(200, { ok: true, outcome: "success", amount: 69, balance: 1069 });
    const onResult = vi.fn();
    render(<CrimeCard onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "Commit a crime" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("It paid off"));
    expect(fetchFn).toHaveBeenCalledWith("/api/economy/crime", { method: "POST" });
    expect(onResult).toHaveBeenCalled();
  });

  it("shows a fine", async () => {
    mockFetch(200, { ok: true, outcome: "fined", amount: 40, finePercent: 20, balance: 160 });
    render(<CrimeCard />);
    fireEvent.click(screen.getByRole("button", { name: "Commit a crime" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Fined 20%"));
  });

  it("disables the button with a countdown while on cooldown", async () => {
    mockFetch(429, { error: "cooldown", readyAt: new Date(Date.now() + 20_000).toISOString() });
    render(<CrimeCard />);
    fireEvent.click(screen.getByRole("button", { name: "Commit a crime" }));
    const btn = await screen.findByRole("button", { name: /Lay low for \d+s/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
