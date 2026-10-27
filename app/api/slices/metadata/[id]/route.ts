// GET /api/slices/metadata/[id] -> ERC-1155 metadata JSON for token id = AttendanceNftCall.id.
// Public and cacheable. Unknown ids are 404. The image is rendered lazily on first request.
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { dayKey } from "@/app/lib/slices/claims";
import { appBaseUrl } from "@/app/lib/slices/config";
import { ensureCallImage, formatSliceDate } from "@/app/lib/slices/art";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  // Accept "12" or "12.json"; reject anything else.
  const m = /^(\d{1,9})(\.json)?$/.exec(raw);
  const id = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const call = await prisma.attendanceNftCall.findUnique({ where: { id } });
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let image = call.imageUrl;
  if (!image) image = await ensureCallImage(id).catch(() => null);
  const day = dayKey(call.callDay);
  const date = formatSliceDate(day);
  const body = {
    name: `${call.crewLabel} Call · ${date}`,
    description: `Proof of attendance for the PizzaDAO ${call.crewLabel} call on ${date}. Non-transferable.`,
    ...(image ? { image } : {}),
    external_url: `${appBaseUrl()}/slices`,
    attributes: [
      { trait_type: "Crew", value: call.crewLabel },
      { trait_type: "Date", value: day },
      { trait_type: "Year", value: day.slice(0, 4) },
    ],
  };
  // Without an image the response is short-lived so a later render is picked up.
  const cache = image ? "public, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=60";
  return NextResponse.json(body, { headers: { "Cache-Control": cache } });
}
