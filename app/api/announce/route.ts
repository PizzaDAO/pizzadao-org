import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import { ANNOUNCE_ALLOWED_DISCORD_IDS } from "@/app/ui/constants";

export const runtime = "nodejs";

// The single announcement this endpoint is scoped to fire (romana-35249).
const ANNOUNCE_SPREADSHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";

// POST /api/announce - Fire the "PizzaDAO Crew" announcement via SecretService.
// Discord login required + allowlist enforced server-side.
export async function POST() {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Allowlist gate - the real access control (UI visibility is convenience only).
  if (!ANNOUNCE_ALLOWED_DISCORD_IDS.includes(session.discordId)) {
    return NextResponse.json(
      { error: "Forbidden: you do not have access to fire announcements" },
      { status: 403 },
    );
  }

  const password = process.env.ANNOUNCE_PASSWORD;
  const url = process.env.ANNOUNCE_WEBAPP_URL;
  if (!password || !url) {
    console.error(
      "[announce] Missing announce config: ANNOUNCE_PASSWORD and/or ANNOUNCE_WEBAPP_URL not set",
    );
    return NextResponse.json(
      { error: "Missing announce config" },
      { status: 500 },
    );
  }

  // Audit trail: who fired the blast.
  console.log(
    `[announce] fired by discordId=${session.discordId} username=${
      session.username ?? "unknown"
    } at ${new Date().toISOString()}`,
  );

  const payload = {
    password,
    spreadsheetId: ANNOUNCE_SPREADSHEET_ID,
    action: "announce",
    options: {
      discordEvent: true,
      tweet: true,
      postGeneral: true,
      postBand: true,
      postCrew: true,
      attendance: true,
    },
  };

  let status: number;
  let text: string;
  try {
    ({ status, text } = await fetchWithRedirect(url, payload));
  } catch (e: unknown) {
    console.error("[announce] fetchWithRedirect failed", e);
    return NextResponse.json(
      { error: "Failed to reach announcement service" },
      { status: 502 },
    );
  }

  // SecretService validates password + spreadsheetId + rate-limiting itself and
  // replies with JSON. Parse defensively; surface its error string.
  let parsed: { success?: boolean; error?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(
      `[announce] Non-JSON response from SecretService (status ${status}): ${text.slice(
        0,
        500,
      )}`,
    );
    return NextResponse.json(
      { error: `Unexpected response from announcement service: ${text.trim().slice(0, 300)}` },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { success: parsed.success, error: parsed.error },
    { status },
  );
}
