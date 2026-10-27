// GET /api/slices/contract-metadata -> OpenSea-style collection metadata (the contract's contractURI)
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/app/lib/slices/config";

export const runtime = "nodejs";

export async function GET() {
  const base = appBaseUrl();
  return NextResponse.json(
    {
      name: "Call Slices",
      description: "PizzaDAO proof of attendance. One slice for every crew call you show up to. Non-transferable.",
      external_link: `${base}/slices`,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600" } },
  );
}
