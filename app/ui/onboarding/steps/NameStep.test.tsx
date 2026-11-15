import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { NameStep } from "./NameStep";

vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: async () => null } as Response)));


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

  it("wizard mode has no typed-name box either: names are pizza-inspired only", () => {
    renderStep();
    expect(screen.queryByPlaceholderText("Your name or nickname")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this name" })).toBeNull();
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
