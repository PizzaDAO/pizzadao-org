import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { NameStep } from "./NameStep";

function Harness({ onPickName }: { onPickName: (n: string) => void }) {
  const [name, setName] = React.useState("");
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <NameStep
        topping=""
        mafiaMovieTitle=""
        style="balanced"
        seenNames={[]}
        mafiaName={name}
        submitting={false}
        onChange={(p: { mafiaName?: string }) => setName(p.mafiaName ?? "")}
        onGenerate={() => {}}
        onPickName={onPickName}
        onBack={() => {}}
        onKeepExisting={() => {}}
        onChangeInputs={() => {}}
      />
    </NextIntlClientProvider>
  );
}

vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: async () => null } as Response)));

function type(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Your name or nickname"), { target: { value } });
}

describe("<NameStep /> display-name preview", () => {
  it("previews the cleaned name and submits it", () => {
    const onPickName = vi.fn();
    render(<Harness onPickName={onPickName} />);
    type("Tony 🍕");
    expect(screen.getByText(/Will be saved as/).textContent).toContain("Tony");
    fireEvent.click(screen.getByRole("button", { name: "Use this name" }));
    expect(onPickName).toHaveBeenCalledWith("Tony");
  });

  it("shows nothing when the name is unchanged", () => {
    render(<Harness onPickName={() => {}} />);
    type("José");
    expect(screen.queryByText(/Will be saved as/)).toBeNull();
  });

  it("disables the button and hints when nothing usable remains", () => {
    render(<Harness onPickName={() => {}} />);
    type("🍕🍕");
    expect(screen.getByText("Use at least one letter or number")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this name" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not preview for whitespace-only differences", () => {
    render(<Harness onPickName={() => {}} />);
    type("Big ");
    expect(screen.queryByText(/Will be saved as/)).toBeNull();
  });
});

function renderStep(extra: Record<string, unknown> = {}) {
  const onPickName = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NameStep
        topping="Pepperoni"
        mafiaMovieTitle="The Godfather"
        style="balanced"
        seenNames={[]}
        submitting={false}
        onChange={() => {}}
        onGenerate={() => {}}
        onPickName={onPickName}
        onBack={() => {}}
        onKeepExisting={() => {}}
        onChangeInputs={() => {}}
        {...(extra as object)}
      />
    </NextIntlClientProvider>,
  );
  return onPickName;
}

describe("<NameStep /> public mode and preselect", () => {
  it("public mode has no typed-name box and no keep-Discord offer", () => {
    renderStep({ mode: "public", discordNick: "SomeNick" });
    expect(screen.queryByPlaceholderText("Your name or nickname")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this name" })).toBeNull();
  });

  it("wizard mode still shows the typed-name box", () => {
    renderStep();
    expect(screen.getByPlaceholderText("Your name or nickname")).toBeTruthy();
  });

  it("opens with the handed-over suggestion selected and claims it", () => {
    const onPickName = renderStep({ suggestions: ["Pepperoni Corleone"], preselectName: "Pepperoni Corleone" });
    fireEvent.click(screen.getByRole("button", { name: /^Claim/i }));
    expect(onPickName).toHaveBeenCalledWith("Pepperoni Corleone");
  });

  it("selects nothing when the preselect is not among the suggestions", () => {
    renderStep({ suggestions: ["Don Basil"], preselectName: "Pepperoni Corleone" });
    expect(screen.queryByRole("button", { name: /^Claim/i })).toBeNull();
  });
});
