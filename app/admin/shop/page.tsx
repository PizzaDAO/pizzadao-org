// app/admin/shop/page.tsx
//
// $PEP shop admin. Server-side gate with the /add-money rule (isPepAdmin:
// admin roles + Pepperoni Mafia); every /api/admin/shop/* route checks it
// again. Replaces the Google-Sheet shop sync, which is now off unless
// SHOP_SHEET_SYNC_ENABLED=1.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { canManageShop } from "@/app/lib/shop-admin-auth";
import { getShopAdminOverview } from "@/app/lib/shop-admin";
import { eventPeople, labelPeople } from "@/app/lib/shop-admin-people";
import { EditorialPage } from "@/app/ui/shared/Editorial";
import ShopAdminClient from "./ShopAdminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Shop",
  description: "Manage the PizzaDAO $PEP shop.",
  robots: { index: false, follow: false },
};

export default async function AdminShopPage() {
  const session = await getSession();
  const allowed = await canManageShop(session?.discordId);

  if (!session || !allowed) {
    return (
      <EditorialPage width="max-w-xl">
        <div className="grid place-items-center text-center min-h-[60vh]">
          <div>
            <p className="overline text-tomato m-0">§ ··· Admin</p>
            <h1 className="font-display font-black text-4xl mt-3 mb-3">Access Denied</h1>
            <p className="text-foreground/65 m-0">
              {session
                ? "The shop admin is for admins and the Pepperoni Mafia."
                : "Please log in with Discord."}
            </p>
            <Link href={session ? "/pep" : "/login"} className="inline-block mt-5 underline">
              {session ? "← Back to the PEP shop" : "Log in"}
            </Link>
          </div>
        </div>
      </EditorialPage>
    );
  }

  const data = await getShopAdminOverview();
  const people = await labelPeople([...eventPeople(data.events), session.discordId]);
  return <ShopAdminClient initial={{ ...data, people }} />;
}
