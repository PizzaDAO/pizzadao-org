// pizzaiolo-13628 — picking a city suggestion resolves its timezone.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import { CityStep } from "./CityStep";

function jsonRes(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

function renderStep(props: Partial<React.ComponentProps<typeof CityStep>> = {}) {
  const onChange = vi.fn();
  const onTimezoneResolved = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CityStep
        city=""
        onChange={onChange}
        onTimezoneResolved={onTimezoneResolved}
        onNext={() => {}}
        onBack={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onChange, onTimezoneResolved };
}

describe("<CityStep /> timezone", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/city-autocomplete") {
        return jsonRes({ predictions: [{ description: "Paris, France", place_id: "paris-1" }] });
      }
      if (url === "/api/city-timezone") {
        return jsonRes({ timezoneId: "Europe/Paris", label: "CEST (UTC+2)" });
      }
      return jsonRes({});
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the timezone when a suggestion is picked", async () => {
    const onTimezoneResolved = vi.fn();
    function Harness() {
      const [city, setCity] = React.useState("");
      return (
        <NextIntlClientProvider locale="en" messages={en}>
          <CityStep
            city={city}
            onChange={setCity}
            onTimezoneResolved={onTimezoneResolved}
            onNext={() => {}}
            onBack={() => {}}
          />
        </NextIntlClientProvider>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Par" } });

    const option = await screen.findByRole("button", { name: "Paris, France" });
    fireEvent.click(option);

    await waitFor(() =>
      expect(onTimezoneResolved).toHaveBeenCalledWith("Europe/Paris", "CEST (UTC+2)"),
    );
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/city-timezone");
    expect(JSON.parse(call![1].body)).toEqual({ place_id: "paris-1" });
  });

  it("clears the timezone when the city is edited by hand", () => {
    const { onTimezoneResolved } = renderStep({ city: "Paris, France" });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris, Texas" } });
    expect(onTimezoneResolved).toHaveBeenCalledWith(null, null);
  });

  it("shows the resolved timezone label", () => {
    renderStep({ city: "Paris, France", timezoneLabel: "CEST (UTC+2)" });
    expect(screen.getByTestId("city-timezone")).toHaveTextContent("Timezone: CEST (UTC+2)");
  });

  it("has the timezone string in every locale", () => {
    for (const messages of [en, es, fr]) {
      expect(messages.onboarding.city.timezoneDetected).toContain("{timezone}");
    }
  });
});
