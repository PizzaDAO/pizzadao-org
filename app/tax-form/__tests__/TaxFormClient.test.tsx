import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { TaxFormClient } from "../TaxFormClient";

const TOKEN = "e2e-fake-token-000000000000000";

const base = {
  payeeLabel: "TEST Payee",
  requester: "Rare Pizzas",
  suggestedFormType: null,
  taxYearNote: null,
  status: "opened",
  locked: false,
  submittedFormType: null,
  rejectedReason: null,
  currentDraft: null,
  storedSecretFields: [],
};

function respond(get: { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      const status = get.status ?? 200;
      return { ok: status < 400, status, json: async () => get.body } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaxFormClient", () => {
  it("shows the invalid card and makes no request when there is no token", () => {
    const f = respond({ body: base });
    renderWithIntl(<TaxFormClient token="" />);
    expect(screen.getByText("This link isn't valid")).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("shows the invalid card on INVALID_TOKEN", async () => {
    respond({ status: 404, body: { error: { message: "x", code: "INVALID_TOKEN" } } });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    expect(await screen.findByText("This link isn't valid")).toBeTruthy();
  });

  it("shows the locked card", async () => {
    respond({ body: { ...base, locked: true, submittedFormType: "w9" } });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    expect(await screen.findByText("Form already submitted")).toBeTruthy();
    expect(screen.getByText(/Rare Pizzas has your W-9 form/)).toBeTruthy();
  });

  it("shows the rejected banner with the reason", async () => {
    respond({ body: { ...base, status: "rejected", rejectedReason: "Name mismatch." } });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    expect(await screen.findByText(/previous form was rejected: Name mismatch\./)).toBeTruthy();
    expect(screen.getByText("Which form applies to you?")).toBeTruthy();
  });

  it("restores a draft with the TIN-on-file banner and an empty SSN", async () => {
    respond({
      body: {
        ...base,
        status: "draft",
        storedSecretFields: ["ssn"],
        currentDraft: { formType: "w9", formData: { name: "Draft Name", taxClassification: "individual" } },
      },
    });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    expect(await screen.findByText(/TIN \/ sensitive details on file/)).toBeTruthy();
    expect((screen.getByDisplayValue("Draft Name") as HTMLInputElement).value).toBe("Draft Name");
    const ssn = document.querySelector('input[placeholder="XXX-XX-XXXX"]') as HTMLInputElement | null;
    expect(ssn).not.toBeNull();
    expect(ssn!.value).toBe("");
  });

  it("picks W-9, then Save draft posts {formType, formData}", async () => {
    const f = respond({ body: base });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    fireEvent.click(await screen.findByText("US individual or business (W-9)"));
    fireEvent.click(await screen.findByText("Save draft"));
    await waitFor(() => expect(screen.getByText("Draft saved.")).toBeTruthy());
    const post = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toContain(`/api/tax-form-requests/${TOKEN}/draft`);
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.formType).toBe("w9");
    expect(typeof body.formData).toBe("object");
  });

  it("submits once on a double click and shows the thank-you card", async () => {
    const f = respond({ body: base });
    renderWithIntl(<TaxFormClient token={TOKEN} />);
    fireEvent.click(await screen.findByText("US individual or business (W-9)"));
    const btn = await screen.findByText("Sign and submit");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByText("Thanks, Rare Pizzas has your form.")).toBeTruthy();
    const posts = f.mock.calls.filter(([u, i]) => (i as RequestInit | undefined)?.method === "POST" && String(u).endsWith("/submit"));
    expect(posts).toHaveLength(1);
  });
});
