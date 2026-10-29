"use client";

// app/ui/passport/InkStamp.tsx
//
// A deterministic SVG "ink stamp" for one pizzeria (plans/pizza-passport.md section 7). The shape,
// rotation and smudge are seeded from the stamp key, so each stamp is unique but stable between
// renders. Without a consented partner logo it is typographic: name on the ring, city and month
// under it, and a pizza-slice glyph. A partner logo, when present, replaces the glyph.
// (A Bolt prototype from the community can restyle this later; the props are the contract.)

import { useId } from "react";

export interface InkStampProps {
    /** Stable seed: stamp id or pizzeria slug. */
    seed: string;
    name: string;
    city?: string | null;
    /** "2026-10" */
    month?: string | null;
    ink?: string | null;
    logoUrl?: string | null;
    verified?: boolean;
    size?: number;
}

const INKS = ["#b3261e", "#1f4e8c", "#2e6b3a", "#5b3a8c", "#222222"];

export function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Shape, rotation (-10..10 deg), ink and filter seed for a stamp key. Exported for tests. */
export function stampStyle(seed: string, ink?: string | null) {
    const h = hashString(seed);
    return {
        shape: (["circle", "rounded", "oval"] as const)[h % 3],
        rotate: ((h >>> 3) % 21) - 10,
        ink: ink && /^#[0-9a-fA-F]{6}$/.test(ink) ? ink : INKS[(h >>> 7) % INKS.length],
        turbulenceSeed: (h >>> 11) % 100,
    };
}

function initials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join("");
}

export function InkStamp({ seed, name, city, month, ink, logoUrl, verified, size = 150 }: InkStampProps) {
    const uid = useId().replace(/:/g, "");
    const st = stampStyle(seed, ink);
    const ringId = `ring-${uid}`;
    const filterId = `rough-${uid}`;
    const maskId = `mask-${uid}`;
    const label = [name, city, month].filter(Boolean).join(", ");
    const rx = st.shape === "circle" ? 90 : st.shape === "oval" ? 90 : 24;
    const ry = st.shape === "circle" ? 90 : st.shape === "oval" ? 66 : 24;
    const w = st.shape === "rounded" ? 172 : st.shape === "oval" ? 180 : 180;
    const h = st.shape === "rounded" ? 150 : st.shape === "oval" ? 132 : 180;
    const x = 100 - w / 2;
    const y = 100 - h / 2;
    const shapeEl = (inset: number, props: React.SVGProps<SVGElement>) =>
        st.shape === "circle" ? (
            <circle cx={100} cy={100} r={90 - inset} {...(props as React.SVGProps<SVGCircleElement>)} />
        ) : st.shape === "oval" ? (
            <ellipse cx={100} cy={100} rx={rx - inset} ry={ry - inset} {...(props as React.SVGProps<SVGEllipseElement>)} />
        ) : (
            <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} rx={rx - inset} {...(props as React.SVGProps<SVGRectElement>)} />
        );

    return (
        <svg
            role="img"
            aria-label={label}
            viewBox="0 0 200 200"
            width={size}
            height={size}
            style={{ transform: `rotate(${st.rotate}deg)`, mixBlendMode: "multiply", overflow: "visible" }}
        >
            <defs>
                <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed={st.turbulenceSeed} result="warp" />
                    <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" />
                </filter>
                <filter id={maskId}>
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={st.turbulenceSeed + 7} result="n" />
                    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.7" result="a" />
                    <feComposite in="SourceGraphic" in2="a" operator="in" />
                </filter>
                <path id={ringId} d="M 100,100 m -66,0 a 66,66 0 1,1 132,0 a 66,66 0 1,1 -132,0" />
            </defs>
            <g filter={`url(#${maskId})`}>
                <g filter={`url(#${filterId})`} fill="none" stroke={st.ink} strokeLinecap="round">
                    {shapeEl(0, { strokeWidth: 5 })}
                    {shapeEl(9, { strokeWidth: 1.8 })}
                    <text fill={st.ink} stroke="none" fontSize="17" fontWeight={700} letterSpacing="2" style={{ textTransform: "uppercase" }}>
                        <textPath href={`#${ringId}`} startOffset="50%" textAnchor="middle">
                            {name.length > 26 ? `${name.slice(0, 25)}…` : name}
                        </textPath>
                    </text>
                    {logoUrl ? (
                        <image href={logoUrl} x={62} y={62} width={76} height={76} preserveAspectRatio="xMidYMid meet" />
                    ) : (
                        <g>
                            <path d="M100 66 L72 124 Q100 142 128 124 Z" fill={st.ink} fillOpacity={0.16} strokeWidth={3} />
                            <circle cx={92} cy={102} r={4.5} fill={st.ink} stroke="none" />
                            <circle cx={108} cy={112} r={4.5} fill={st.ink} stroke="none" />
                            <circle cx={99} cy={88} r={3.5} fill={st.ink} stroke="none" />
                            <text x={100} y={150} textAnchor="middle" fill={st.ink} stroke="none" fontSize="15" fontWeight={700} letterSpacing="3">
                                {initials(name)}
                            </text>
                        </g>
                    )}
                    {(city || month) && (
                        <text x={100} y={168} textAnchor="middle" fill={st.ink} stroke="none" fontSize="11" letterSpacing="1.5" style={{ textTransform: "uppercase" }}>
                            {[city, month?.replace("-", " · ")].filter(Boolean).join(" · ").slice(0, 30)}
                        </text>
                    )}
                    {verified && <path d="M150 52 l7 7 l13 -15" strokeWidth={4} />}
                </g>
            </g>
        </svg>
    );
}
