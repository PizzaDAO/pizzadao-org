import { after } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "./db";

export const ACTIVATION_STAGES = ["signup_started", "dm_sent", "discord_verified", "profile_created", "first_contribution"] as const;
export type ActivationEventName = typeof ACTIVATION_STAGES[number] | "login_failed" | "profile_save_failed" | "client_error";
export const activationActor = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : undefined;

/** Best effort and deduplicated; never make onboarding depend on analytics. */
export async function recordActivation(event: ActivationEventName, input: { actor?: string; discordId?: string; code?: string } = {}) {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return;
    const memberKey = input.discordId ? createHmac("sha256", secret).update(`activation:${input.discordId}`).digest("hex") : undefined;
    let actor = activationActor(input.actor);
    if (!actor && memberKey) {
      const signup = await prisma.activationEvent.findFirst({ where: { memberKey, event: "profile_created" }, orderBy: { createdAt: "desc" }, select: { actor: true } });
      actor = signup?.actor || memberKey;
    }
    if (!actor) return;
    const code = input.code && /^[a-z0-9_]{1,48}$/.test(input.code) ? input.code : "";
    await prisma.activationEvent.upsert({ where: { actor_event_code: { actor, event, code } }, create: { actor, event, code, memberKey }, update: {} });
  } catch {
    console.error("[activation] Event storage unavailable", event);
  }
}

/** Keep product requests fast; Next keeps the event write alive after responding. */
export function recordActivationLater(event: ActivationEventName, input: { actor?: string; discordId?: string; code?: string } = {}) {
  try { after(() => recordActivation(event, input)); }
  catch { void recordActivation(event, input); }
}
