/** Only allow a local page path; never redirect login to another origin or API. */
export function loginReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return;
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value, "https://pizzadao.org");
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== "https://pizzadao.org" || path.startsWith("//") || path.includes("\\")) return;
    if (/^\/(api|login|join)(\/|$)/.test(path)) return;
    return url.pathname + url.search + url.hash;
  } catch {
    return;
  }
}

/**
 * The /login page, carrying this page's ?returnTo (re-validated) so a visitor who switches from
 * /join to log in still lands where they were headed. `search` is a location.search string.
 */
export function loginPageHref(search: string, extra = ""): string {
  const returnTo = loginReturnPath(new URLSearchParams(search).get("returnTo"));
  const params = new URLSearchParams(extra);
  if (returnTo) params.set("returnTo", returnTo);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

/**
 * Where a tab should go once it finds itself logged in (e.g. the "check your DMs" tab after the link
 * was opened in another tab of the same browser). Mirrors the magic-link landing: a linked member
 * goes to the sanitized return path or their dashboard; anyone else to the wizard with their Discord
 * identity (which links/claims the row and then honours returnTo).
 */
export function loggedInLanding(
  me: { discordId?: string | null; memberId?: string | null; nick?: string | null; username?: string | null },
  opts: { returnTo?: unknown; wizardHome: string; resumeSignup?: boolean },
): string {
  const returnTo = loginReturnPath(opts.returnTo);
  if (me.memberId) return returnTo || `/dashboard/${encodeURIComponent(me.memberId)}`;
  if (!me.discordId) return returnTo || opts.wizardHome;
  const params = new URLSearchParams();
  if (opts.resumeSignup) params.set("resumeSignup", "1");
  params.set("discordId", me.discordId);
  params.set("discordJoined", "1");
  const nick = me.nick || me.username;
  if (nick) params.set("discordNick", nick);
  if (returnTo) params.set("returnTo", returnTo);
  return `${opts.wizardHome}?${params.toString()}`;
}

/** The /login link for a page's "Log in" button: comes back to that page (never to "/" or the wizard). */
export function loginHrefFrom(path: string | null | undefined): string {
  const returnTo = loginReturnPath(path ?? undefined);
  if (!returnTo || returnTo === "/" || /^\/start(\/|\?|#|$)/.test(returnTo)) return "/login";
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
