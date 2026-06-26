import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { getCityChatBySlug } from "@/app/lib/chats";

export const runtime = "nodejs";

type Params = { params: Promise<{ city: string }> };

// /chats/[city] - auth-gated server redirect straight to the city's Telegram chat.
export default async function CityChatRedirect({ params }: Params) {
  const session = await getSession();
  if (!session?.discordId) {
    redirect("/api/discord/login");
  }

  const { city } = await params;
  const match = await getCityChatBySlug(city);

  if (match) {
    redirect(match.chatUrl);
  }

  redirect("/chats");
}
