// app/made/[id]/og/route.tsx
//
// Share card for /made/[id] when the claim has no portrait: 1200x630, the
// certificate style with the topping picture and the mafia name. (Portraits are
// WebP, which the OG renderer cannot embed, so claims with a portrait use the
// portrait file itself as their share image; see the page metadata.)
//
// Text is Latin-only in the renderer's bundled font: names outside it fall back
// to the generic glyph boxes, which is acceptable for a share card. The card is
// a share asset, not a page: it is marked noindex.
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { getPublicClaim } from "@/app/lib/mafia-claim";
import { toppingImageFor } from "@/app/lib/topping-images";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await getPublicClaim(id);
  if (!claim) return new Response("Not found", { status: 404 });

  const t = await getTranslations("made");
  const toppingPath = claim.topping ? toppingImageFor(claim.topping) : undefined;
  const toppingUrl = toppingPath ? new URL(toppingPath, req.url).toString() : undefined;
  const size = claim.name.length > 28 ? 64 : 84;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: 64,
          background: "#fbf3e4",
          color: "#2a1a10",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 360,
            height: 360,
            flexShrink: 0,
            borderRadius: 180,
            border: "10px solid #d9432b",
            overflow: "hidden",
            background: "#fff8ec",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 120,
          }}
        >
          {toppingUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={toppingUrl} width={360} height={360} alt="" style={{ objectFit: "cover" }} />
          ) : (
            "🍕"
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, flex: 1 }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, color: "#b3321e", textTransform: "uppercase" }}>
            {t("record")}
          </div>
          <div style={{ display: "flex", fontSize: size, fontWeight: 900, lineHeight: 1, marginTop: 20 }}>{claim.name}</div>
          <div style={{ display: "flex", fontSize: 32, marginTop: 28, color: "#6b5545" }}>{t("ogTagline")}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "X-Robots-Tag": "noindex" } },
  );
}
