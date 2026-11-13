"use client";

const crowdUrl = "/marketing/assets/texture-crowd.jpg";
const handsUrl = "/marketing/assets/texture-hands.jpg";
const cityUrl = "/marketing/assets/texture-city.jpg";
const tableUrl = "/marketing/assets/texture-table.jpg";
type Variant = "crowd" | "hands" | "city" | "table";

type Position =
  | "full"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-right"
  | "bottom-left";

interface PhotoVeilProps {
  variant: Variant;
  position?: Position;
  /** 0..1 - keep extremely low (0.04–0.10). */
  opacity?: number;
  /** "multiply" for cream surfaces, "screen" for dark/ink surfaces. */
  blend?: "multiply" | "screen" | "soft-light";
  className?: string;
}

const SRC: Record<Variant, string> = {
  crowd: crowdUrl,
  hands: handsUrl,
  city: cityUrl,
  table: tableUrl,
};

const POS: Record<Position, string> = {
  full: "inset-0",
  top: "inset-x-0 top-0 h-2/3",
  bottom: "inset-x-0 bottom-0 h-2/3",
  left: "inset-y-0 left-0 w-2/3",
  right: "inset-y-0 right-0 w-2/3",
  "top-right": "right-0 top-0 h-2/3 w-2/3",
  "bottom-left": "left-0 bottom-0 h-2/3 w-2/3",
};

/**
 * Photographic emotional texture - monochrome, heavily blurred, low-opacity.
 * Sits as an aria-hidden absolute layer inside a `relative overflow-hidden` parent.
 * Never dominates: integrates as tonal atmosphere only.
 */
export const PhotoVeil = ({
  variant,
  position = "full",
  opacity = 0.06,
  blend = "multiply",
  className = "",
}: PhotoVeilProps) => {
  // Soft radial mask fades the photo into surrounding paper.
  const maskImage =
    position === "full"
      ? "radial-gradient(ellipse at center, black 35%, transparent 78%)"
      : position.includes("top")
      ? "linear-gradient(to bottom, black 10%, transparent 90%)"
      : position.includes("bottom")
      ? "linear-gradient(to top, black 10%, transparent 90%)"
      : position.includes("left")
      ? "linear-gradient(to right, black 10%, transparent 85%)"
      : "linear-gradient(to left, black 10%, transparent 85%)";

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${POS[position]} ${className}`}
      style={{
        backgroundImage: `url(${SRC[variant]})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity,
        mixBlendMode: blend,
        filter: "grayscale(1) blur(2px) contrast(0.9)",
        WebkitMaskImage: maskImage,
        maskImage,
      }}
    />
  );
};

export default PhotoVeil;
