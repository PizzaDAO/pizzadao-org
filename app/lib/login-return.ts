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
