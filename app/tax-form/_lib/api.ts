// Browser client for the rsv-pizza public tax-form-request API. Called directly from the
// payee's browser so the signer IP and rate limits are per payee (see plans/tax-form-native.md).
// Never log the token or formData here.
import type { TaxFormType } from "./types";

export type { TaxFormType };

export const TAX_FORM_API_BASE = (
  process.env.NEXT_PUBLIC_RSV_PIZZA_API_URL?.trim() || "https://api.rsv.pizza"
).replace(/\/+$/, "");

export type TaxFormRequestStatus =
  | "sent" | "opened" | "draft" | "submitting" | "submitted" | "verified" | "rejected";

export interface PublicTaxFormRequest {
  payeeLabel: string;
  requester: string;
  suggestedFormType: TaxFormType | null;
  taxYearNote: string | null;
  status: TaxFormRequestStatus;
  locked: boolean;
  submittedFormType: TaxFormType | null;
  rejectedReason: string | null;
  currentDraft: { formType: TaxFormType; formData: Record<string, any> } | null;
  storedSecretFields: string[];
}

export type TaxFormApiError = Error & { code?: string; status?: number };

function makeError(message: string, code?: string, status?: number): TaxFormApiError {
  const e = new Error(message) as TaxFormApiError;
  e.code = code;
  e.status = status;
  return e;
}

async function request<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${TAX_FORM_API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init ? { "Content-Type": "application/json" } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw makeError("Network error", "NETWORK_ERROR");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code: string | undefined = data?.error?.code ?? (res.status === 429 ? "RATE_LIMITED" : undefined);
    throw makeError(data?.error?.message || `Request failed (${res.status})`, code, res.status);
  }
  return data as T;
}

const base = (token: string) => `/api/tax-form-requests/${encodeURIComponent(token)}`;

export const getRequest = (token: string) => request<PublicTaxFormRequest>(base(token));

export const saveDraft = async (token: string, formType: TaxFormType, formData: Record<string, any>) => {
  await request(`${base(token)}/draft`, { method: "POST", body: { formType, formData } });
};

export const submit = async (token: string, formType: TaxFormType, formData: Record<string, any>) => {
  await request(`${base(token)}/submit`, { method: "POST", body: { formType, formData } });
};
