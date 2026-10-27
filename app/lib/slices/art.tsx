// Per-call slice artwork: the crew's template (or the default one) with the crew
// name, call date and slice number stamped on, rendered once with next/og and
// stored in Vercel Blob. The stored PNG is immutable, so serving it is cheap.
import { ImageResponse } from "next/og";
import { put } from "@vercel/blob";
import { prisma } from "@/app/lib/db";
import { dayKey } from "./claims";

export const SLICE_IMAGE_SIZE = 1000;

export function formatSliceDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Render the PNG for a call. `templateUrl` null = default template. */
export async function renderSliceImage(opts: { id: number; crewLabel: string; day: string; templateUrl: string | null }): Promise<ArrayBuffer> {
  const { id, crewLabel, day, templateUrl } = opts;
  const labelSize = crewLabel.length > 22 ? 56 : crewLabel.length > 14 ? 72 : 88;
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#fbf3e4", color: "#2a1a10" }}>
        {templateUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={templateUrl} width={SLICE_IMAGE_SIZE} height={SLICE_IMAGE_SIZE} alt="" style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} />
        ) : (
          <div style={{ position: "absolute", top: 90, left: 0, width: "100%", display: "flex", justifyContent: "center", fontSize: 420 }}>{"\u{1F355}"}</div>
        )}
        <div style={{ position: "absolute", inset: 24, display: "flex", border: "10px solid #d9432b", borderRadius: 48 }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "36px 48px 64px",
            background: "rgba(251,243,228,0.94)",
            borderTop: "8px solid #d9432b",
          }}
        >
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, color: "#b3321e", textTransform: "uppercase" }}>Call Slice #{id}</div>
          <div style={{ display: "flex", fontSize: labelSize, fontWeight: 900, lineHeight: 1.05, marginTop: 10, textAlign: "center" }}>{crewLabel}</div>
          <div style={{ display: "flex", fontSize: 40, marginTop: 14, color: "#6b5545" }}>{formatSliceDate(day)}</div>
        </div>
      </div>
    ),
    { width: SLICE_IMAGE_SIZE, height: SLICE_IMAGE_SIZE },
  );
  return res.arrayBuffer();
}

/** Render + store the image for a call if it has none (or `force`). Returns the Blob URL. */
export async function ensureCallImage(callId: number, force = false): Promise<string | null> {
  const call = await prisma.attendanceNftCall.findUnique({ where: { id: callId } });
  if (!call) return null;
  if (call.imageUrl && !force) return call.imageUrl;
  const art = await prisma.sliceCrewArt.findUnique({ where: { crewId: call.crewId } });
  const png = await renderSliceImage({ id: call.id, crewLabel: call.crewLabel, day: dayKey(call.callDay), templateUrl: art?.imageUrl ?? null });
  const blob = await put(`slices/${call.id}-${Date.now()}.png`, Buffer.from(png), { access: "public", addRandomSuffix: false, contentType: "image/png" });
  await prisma.attendanceNftCall.update({ where: { id: call.id }, data: { imageUrl: blob.url } });
  return blob.url;
}

/** Best-effort: never let artwork problems affect a claim. */
export async function ensureCallImagesSafe(callIds: number[]): Promise<void> {
  for (const id of new Set(callIds)) {
    try {
      await ensureCallImage(id);
    } catch (e) {
      console.error("[slices] image render failed for call", id, e instanceof Error ? e.message : e);
    }
  }
}
