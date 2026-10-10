import { sanitizeDisplayName } from "./display-name";

export const SIGNUP_DRAFT_COOKIE = "pd_signup_draft";
export const SIGNUP_DRAFT_TTL_SECONDS = 30 * 60;
export type SignupDraft = { mafiaName: string; city: string; sessionId: string; memberId?: string; timezone?: string; cityRegion?: string; topping?: string; invitedBy?: { memberId: string; name: string; viaLink?: boolean } | null };

/** Only profile fields; never restore identity, roles, permissions, or arbitrary JSON. */
export function sanitizeSignupDraft(value: unknown): SignupDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (key: string, max: number) => typeof v[key] === "string" ? (v[key] as string).trim().slice(0, max) : "";
  const mafiaName = sanitizeDisplayName(str("mafiaName", 64));
  const city = str("city", 120);
  if (!mafiaName || !city) return null;
  const sessionId = str("sessionId", 80);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sessionId)) return null;
  const draft: SignupDraft = { mafiaName, city, sessionId };
  const memberId = str("memberId", 20);
  if (/^[1-9]\d{0,9}$/.test(memberId)) draft.memberId = memberId;
  draft.cityRegion = str("cityRegion", 40);
  draft.topping = str("topping", 50);
  const timezone = str("timezone", 80);
  if (timezone) {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); draft.timezone = timezone; } catch {}
  }
  if (v.invitedBy === null) draft.invitedBy = null;
  const inviter = v.invitedBy as Record<string, unknown> | undefined;
  if (inviter && typeof inviter.memberId === "string" && /^\d{1,10}$/.test(inviter.memberId)) {
    draft.invitedBy = { memberId: inviter.memberId, name: String(inviter.name || "").slice(0, 80), viaLink: inviter.viaLink === true };
  }
  return draft;
}
