// L3.1 "Who invited you?" onboarding step: search, pick, "no one", and the
// invite-link pre-fill, in en / es / fr.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import { InvitedByStep } from "./InvitedByStep";

function renderStep(props: Partial<React.ComponentProps<typeof InvitedByStep>> = {}, locale: "en" | "es" | "fr" = "en") {
  const onChange = vi.fn();
  const onNext = vi.fn();
  const messages = { en, es, fr }[locale];
  const utils = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <InvitedByStep value={undefined} ownMemberId="9001" onChange={onChange} onNext={onNext} onBack={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onChange, onNext };
}

describe("<InvitedByStep />", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        members: [
          { memberId: "42", name: "Don Pepperoni", city: "Lisbon" },
          { memberId: "9001", name: "Myself", city: null },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searches members and picks one (never yourself)", async () => {
    const { onChange } = renderStep();
    fireEvent.change(screen.getByPlaceholderText("Name or member ID"), { target: { value: "don" } });
    const option = await screen.findByText("Don Pepperoni");
    expect(fetchMock).toHaveBeenCalledWith("/api/referrals/inviters?q=don");
    expect(screen.queryByText("Myself")).toBeNull();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith({ memberId: "42", name: "Don Pepperoni" });
  });

  it('"No one invited me" answers null; skipping leaves it unanswered', () => {
    const { onChange, onNext } = renderStep();
    fireEvent.click(screen.getByText("No one invited me"));
    expect(onChange).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByText("Skip"));
    expect(onNext).toHaveBeenCalled();
  });

  it("shows the inviter from an invite link; Change clears it to 'no one'", () => {
    const { onChange } = renderStep({ value: { memberId: "42", name: "Don Pepperoni", viaLink: true } });
    expect(screen.getByTestId("invited-by-selected").textContent).toContain("Don Pepperoni");
    expect(screen.getByText("§ Invited by (from your invite link)")).toBeTruthy();
    fireEvent.click(screen.getByText("Change"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it.each([
    ["es", "Nadie me invitó", "Nombre o ID de miembro"],
    ["fr", "Personne ne m’a invité", "Nom ou ID de membre"],
  ] as const)("is translated (%s)", async (locale, nobody, placeholder) => {
    renderStep({}, locale);
    expect(screen.getByText(nobody)).toBeTruthy();
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
