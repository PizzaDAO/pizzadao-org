import { describe, it, expect, beforeEach } from "vitest";
import { decodeOAuthState } from "@/app/lib/oauth-proxy";
import { discordLoginHref } from "@/app/ui/onboarding/MagicLoginFlow";

async function stateFor(qs: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://localhost:3000/api/discord/login${qs}`));
  return decodeOAuthState(new URL(res.headers.get("location")!).searchParams.get("state")!);
}

describe("Discord login: next", () => {
  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "x";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
  });

  it("carries a local next path in the OAuth state, separate from return_to", async () => {
    const s = await stateFor("?next=%2Fmissions%23mission-7");
    expect(s.next).toBe("/missions#mission-7");
    expect(s.return_to).toBeUndefined();
  });

  it("drops external next targets", async () => {
    expect((await stateFor("?next=https%3A%2F%2Fevil.example")).next).toBeUndefined();
    expect((await stateFor("?next=%2F%2Fevil.example")).next).toBeUndefined();
  });

  it("builds the login href from the page's returnTo", () => {
    expect(discordLoginHref("?returnTo=%2Fmissions")).toBe("/api/discord/login?next=%2Fmissions");
    expect(discordLoginHref("")).toBe("/api/discord/login");
  });
});
