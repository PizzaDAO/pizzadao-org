// Default share card for /get-your-mafia-name: 1200x630, the certificate
// palette used by /made/[id]/og. Latin-only text in the renderer's bundled font.
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "PizzaDAO · Get your mafia name";

export default async function Image() {
  const t = await getTranslations("mafiaPublic");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#fbf3e4",
          color: "#2a1a10",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#b3321e", textTransform: "uppercase" }}>
          {t("overline")}
        </div>
        <div style={{ display: "flex", fontSize: 104, fontWeight: 900, lineHeight: 1, marginTop: 24 }}>
          {t("metaTitle")}
        </div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 32, color: "#6b5545" }}>{t("intro")}</div>
      </div>
    ),
    size,
  );
}
