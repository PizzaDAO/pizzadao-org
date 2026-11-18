// Share card for /trivia: 1200x630, the same certificate palette as /get-your-mafia-name.
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "PizzaDAO Pizza Trivia";

export default async function Image() {
  const t = await getTranslations("trivia");
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
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#b3321e", textTransform: "uppercase" }}>PizzaDAO</div>
        <div style={{ display: "flex", fontSize: 120, fontWeight: 900, lineHeight: 1, marginTop: 24 }}>{t("metaTitle")}</div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 32, color: "#6b5545" }}>{t("dek")}</div>
      </div>
    ),
    size,
  );
}
