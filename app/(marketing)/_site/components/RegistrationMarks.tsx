"use client";

/**
 * RegistrationMarks - editorial crop / registration marks at the four corners
 * of a section. Reads as printer's marks on a press sheet, not as decoration.
 * Place inside a `relative` container; sits behind content (pointer-events-none).
 */
type Props = {
  tone?: "ink" | "cream";
  /** 0–1, defaults to subtle */
  opacity?: number;
  /** distance from the section edges in px */
  inset?: number;
  /** mark size in px */
  size?: number;
  /** which corners to render - defaults to all four */
  corners?: Array<"tl" | "tr" | "bl" | "br">;
  /** show a small folio mark (e.g. "§ B.04") near bottom-right */
  folio?: string;
};

const Mark = ({
  size,
  stroke,
}: { size: number; stroke: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
  >
    {/* registration cross: thin lines with a tiny center circle */}
    <line x1="0" y1="12" x2="9" y2="12" stroke={stroke} strokeWidth="0.75" />
    <line x1="15" y1="12" x2="24" y2="12" stroke={stroke} strokeWidth="0.75" />
    <line x1="12" y1="0" x2="12" y2="9" stroke={stroke} strokeWidth="0.75" />
    <line x1="12" y1="15" x2="12" y2="24" stroke={stroke} strokeWidth="0.75" />
    <circle cx="12" cy="12" r="2.6" stroke={stroke} strokeWidth="0.75" />
  </svg>
);

const RegistrationMarks = ({
  tone = "ink",
  opacity = 0.22,
  inset = 18,
  size = 14,
  corners = ["tl", "tr", "bl", "br"],
  folio,
}: Props) => {
  const stroke = tone === "ink" ? "hsl(var(--ink))" : "hsl(var(--cream))";
  const positions: Record<typeof corners[number], React.CSSProperties> = {
    tl: { top: inset, left: inset },
    tr: { top: inset, right: inset },
    bl: { bottom: inset, left: inset },
    br: { bottom: inset, right: inset },
  };
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ opacity }}
    >
      {corners.map((c) => (
        <span key={c} className="absolute" style={positions[c]}>
          <Mark size={size} stroke={stroke} />
        </span>
      ))}
      {folio && (
        <span
          className="ui absolute text-[9px] font-medium uppercase tracking-[0.28em]"
          style={{
            bottom: inset + 2,
            right: inset + size + 10,
            color: stroke,
            opacity: 0.85,
          }}
        >
          {folio}
        </span>
      )}
    </div>
  );
};

export default RegistrationMarks;
