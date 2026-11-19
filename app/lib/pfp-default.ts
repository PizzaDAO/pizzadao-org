/**
 * The default profile picture ("dough ball") for members without a PFP generated on this platform.
 * Client-safe (no fs). A member's Discord avatar is never used as their PFP.
 */
export const DEFAULT_PFP_URL = "/pfp/default.png";
export const DEFAULT_PFP_ALT = "Default PizzaDAO profile picture";

/** The picture to render for a member: their resolved PFP, else the default. */
export function pfpOrDefault(url: string | null | undefined): string {
  return url || DEFAULT_PFP_URL;
}
