// Admin: per-crew slice template art.
// POST multipart { crewId, file } (square PNG/JPEG, 5 MB) -> { crewId, imageUrl }
// DELETE { crewId } -> falls back to the default template
// New art applies to calls created afterwards; use "re-render" on the admin page for existing ones.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { fileFromForm, uploadImageToBlob } from "@/app/lib/blob-image-upload";
import { sniffImageFile } from "@/app/lib/image-sniff";
import { handleApiError } from "@/app/lib/errors/error-response";
import { ValidationError } from "@/app/lib/errors/api-errors";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const form = await req.formData();
    const crewId = String(form.get("crewId") ?? "").trim();
    if (!crewId || crewId.length > 80) throw new ValidationError("crewId is required", "crewId");
    const file = fileFromForm(form);
    // The OG renderer cannot embed WebP/GIF, so only PNG and JPEG are accepted here.
    const sniffed = await sniffImageFile(file);
    if (!sniffed || (sniffed.mime !== "image/png" && sniffed.mime !== "image/jpeg")) {
      throw new ValidationError("Use a PNG or JPEG", "file");
    }
    const { url } = await uploadImageToBlob(file, `slices/templates/${crewId.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    await prisma.sliceCrewArt.upsert({ where: { crewId }, create: { crewId, imageUrl: url }, update: { imageUrl: url } });
    return NextResponse.json({ crewId, imageUrl: url });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const body = (await req.json().catch(() => null)) as { crewId?: unknown } | null;
  if (typeof body?.crewId !== "string" || !body.crewId) return NextResponse.json({ error: "crewId required" }, { status: 400 });
  await prisma.sliceCrewArt.deleteMany({ where: { crewId: body.crewId } });
  return NextResponse.json({ ok: true });
}
