// app/lib/auth/issue-login-session.ts
//
// The session-building block shared by the magic-link login and "Sign in with Telegram": sign the session
// token, look up the member row already linked to this Discord id, and sync Discord roles to it. Cookies and
// the redirect/landing stay with each caller.
import { createSessionToken, type Session } from "@/app/lib/session";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";
import { syncRolesOnLogin } from "@/app/lib/sync-roles-on-login";

export interface IssuedLoginSession {
  token: string;
  memberId?: string;
  memberName?: string;
}

export async function issueLoginSession(opts: {
  discordId: string;
  username?: string;
  nick?: string;
  authMethod?: Session["authMethod"];
}): Promise<IssuedLoginSession> {
  const token = createSessionToken({
    discordId: opts.discordId,
    username: opts.username,
    nick: opts.nick,
    createdAt: Date.now(),
    ...(opts.authMethod ? { authMethod: opts.authMethod } : {}),
  });

  // Look up the member row already linked to this Discord ID (direct lib call).
  // Unlinked users are sent to onboarding, where the wizard's name-match
  // auto-claim (/api/auto-claim, session-authenticated) links the row.
  // Role sync never links rows itself.
  let memberId: string | undefined;
  let memberName: string | undefined;
  try {
    const found = await fetchMemberByDiscordId(opts.discordId);
    if (found?.memberId) {
      memberId = String(found.memberId);
      memberName = found.name || undefined;
    }
  } catch {
    // Lookup failure is non-fatal: the session is still created and the member goes to onboarding.
  }

  // Always sync Discord roles to the (already linked) sheet row, mirroring the OAuth callback.
  syncRolesOnLogin(opts.discordId, memberName ?? opts.nick ?? opts.username).catch(() => {});

  return { token, memberId, memberName };
}
