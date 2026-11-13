"use client";

/**
 * PartnersGlobe - premium global systems visualization for the Partners hero.
 *
 * Editorial register: Monocle infographic / Apple systems diagram.
 * Not interactive. Slow rotation. No tooltips, no clicks.
 *
 * Layers (back to front):
 *   1. Ambient warmth halo
 *   2. Matte sphere with soft directional shading
 *   3. SVG: graticule (d3.geoGraticule10, rotating with yaw)
 *   4. SVG: real continent silhouettes (world-atlas land-110m via d3-geo)
 *   5. SVG: faint great-circle network arcs between marquee chapters
 *   6. SVG: city dots in 3-tier hierarchy
 *   7. SVG: single quiet pulse on marquee dots
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { geoOrthographic, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, MultiPolygon } from "geojson";
import citiesData from "@/app/(marketing)/_site/data/pizzadao-cities.json";

type City = { name: string; coords: [number, number] };

const CITIES: City[] = (citiesData as Array<{ name: string; coords: unknown }>)
  .filter((c) => Array.isArray(c.coords) && (c.coords as number[]).length === 2)
  .map((c) => ({ name: c.name, coords: c.coords as [number, number] }));

// Anchor cities - intentional, not data-dense. These are the only larger dots.
const ANCHORS = new Set([
  "New York", "London", "Lagos", "Tokyo",
  "São Paulo", "Sao Paulo", "Sydney", "Mumbai", "Mexico City",
  "Milan", "Berlin", "Istanbul",
]);

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
// A sparser secondary tier - small ink dots, intentional clusters only.
const MID = new Set(
  CITIES.filter((c) => !ANCHORS.has(c.name) && hash(c.name) % 5 === 0).map((c) => c.name),
);

// Hand-annotated whispers near specific cities. Sentence case, never shouty.
type Annotation = { city: string; text: string; dx: number; dy: number; anchor?: "start" | "end" };
const ANNOTATIONS: Annotation[] = [
  { city: "Milan",       text: "ciao from milan",     dx:  3, dy: -2 },
  { city: "Mexico City", text: "hola from cdmx",      dx: -3, dy:  3, anchor: "end" },
  { city: "Tokyo",       text: "gm from tokyo",       dx:  3, dy: -2 },
  { city: "New York",    text: "irl > ads",           dx: -3, dy: -2, anchor: "end" },
  { city: "Lagos",       text: "shared slices",       dx:  3, dy:  3 },
  { city: "London",      text: "one bite at a time",  dx:  3, dy: -2 },
  { city: "São Paulo",   text: "pizza the planet",    dx: -3, dy:  3, anchor: "end" },
  { city: "Mumbai",      text: "community first",     dx:  3, dy: -2 },
  { city: "Berlin",      text: "geteilte stücke",     dx:  3, dy: -2 },
  { city: "Istanbul",    text: "selam, dilim hazır",  dx: -3, dy:  3, anchor: "end" },
];

const VB = 100;
const CX = 50;
const CY = 50;
const R = 48;
const TILT = -18; // degrees, applied as projection rotate Y

// Decode the world-atlas land topology once.
const LAND_FEATURE = feature(
  landTopo as unknown as Topology,
  (landTopo as unknown as Topology).objects.land as GeometryCollection,
) as unknown as Feature<MultiPolygon>;

const GRATICULE = geoGraticule10();

const PartnersGlobe = () => {
  const [yaw, setYaw] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      // ~140s per revolution
      setYaw(((t - start) / 140000) * 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Projection rebuilt per frame (cheap)
  const { landPath, graticulePath, projected, labels } = useMemo(() => {
    const projection = geoOrthographic()
      .scale(R)
      .translate([CX, CY])
      .clipAngle(90)
      .rotate([yaw, TILT, 0]);
    const path = geoPath(projection);

    const landPath = path(LAND_FEATURE) ?? "";
    const graticulePath = path(GRATICULE) ?? "";

    const projected = CITIES.flatMap((c, i) => {
      const visiblePoint = path({ type: "Point", coordinates: c.coords });
      if (!visiblePoint) return [];
      const p = projection(c.coords);
      if (!p) return [];
      const tier = ANCHORS.has(c.name) ? 2 : MID.has(c.name) ? 1 : 0;
      // distance from sphere center; used to fade dots near the limb
      const d = Math.hypot(p[0] - CX, p[1] - CY);
      const vis = Math.max(0, 1 - d / R);
      return [{ i, name: c.name, px: p[0], py: p[1], tier, vis }];
    });

    const labels = ANNOTATIONS.flatMap((a, i) => {
      const city = CITIES.find((c) => c.name === a.city);
      if (!city) return [];
      const visiblePoint = path({ type: "Point", coordinates: city.coords });
      if (!visiblePoint) return [];
      const p = projection(city.coords);
      if (!p) return [];
      const d = Math.hypot(p[0] - CX, p[1] - CY);
      const vis = Math.max(0, 1 - d / R);
      // Slow per-label heartbeat - long "on" window so each bubble lingers
      // long enough to read. Cycle ~22s, ~60% on, staggered by index.
      const cyclePos = (((yaw / 360) * 6 + i * 0.37) % 1 + 1) % 1;
      const onWindow = cyclePos > 0.18 && cyclePos < 0.78;
      const visible = vis > 0.32 && onWindow;
      return [{ ...a, i, px: p[0], py: p[1], visible }];
    });


    return { landPath, graticulePath, projected, labels };
  }, [yaw]);

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[520px]"
      aria-hidden="true"
    >
      {/* Outer ambient warmth */}
      <div
        className="absolute inset-[-12%] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--tomato) / 0.09), transparent 65%)",
        }}
      />

      {/* Matte sphere */}
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          background:
            "radial-gradient(circle at 34% 30%, hsl(44 45% 96%) 0%, hsl(40 30% 90%) 50%, hsl(32 18% 76%) 100%)",
          boxShadow:
            "inset -22px -30px 60px -22px hsl(28 30% 18% / 0.22), inset 16px 18px 42px -18px hsl(var(--cream) / 0.85), 0 28px 70px -28px hsl(0 0% 0% / 0.32)",
        }}
      >
        {/* Directional shading - soft terminator toward lower-right */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 72% 76%, hsl(28 25% 12% / 0.18), transparent 58%)",
          }}
        />
        {/* Specular highlight - soft matte, no gloss */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 30% 24%, hsl(var(--cream) / 0.5), transparent 42%)",
          }}
        />

        {/* Vector overlay - graticule, continents, arcs, dots */}
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <clipPath id="sphereClip">
              <circle cx={CX} cy={CY} r={R} />
            </clipPath>
          </defs>

          <g clipPath="url(#sphereClip)">
            {/* Graticule - hairline, rotates with globe */}
            <path
              d={graticulePath}
              fill="none"
              stroke="hsl(28 20% 25% / 0.08)"
              strokeWidth="0.18"
            />

            {/* Continental silhouettes - soft warm ink, multiply blend */}
            <g style={{ mixBlendMode: "multiply" }}>
              <path
                d={landPath}
                fill="hsl(28 28% 20%)"
                fillOpacity="0.22"
                stroke="hsl(28 28% 15%)"
                strokeOpacity="0.28"
                strokeWidth="0.18"
                strokeLinejoin="round"
              />
            </g>

            {/* City dots - three tiers, anchors dominate but all chapters render */}
            <g fill="hsl(var(--ink))">
              {projected.map((p) => {
                const r = p.tier === 2 ? 1.05 : p.tier === 1 ? 0.55 : 0.28;
                const base = p.tier === 2 ? 0.92 : p.tier === 1 ? 0.6 : 0.32;
                const op = base * (0.4 + 0.6 * p.vis);
                return (
                  <circle
                    key={p.i}
                    cx={p.px}
                    cy={p.py}
                    r={r}
                    opacity={op}
                  />
                );
              })}
            </g>


          </g>
        </svg>

        {/* Tactile grain - softens the perfection of the render */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full mk-grain"
          style={{ mixBlendMode: "multiply", opacity: 0.55 }}
        />
      </div>

      {/* Speech bubbles overlay - rendered OUTSIDE the sphere's overflow-hidden
          and outside the clipPath so they are never cropped by the globe edge. */}
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <g
          style={{
            fontFamily: "'Asap', ui-sans-serif, system-ui, sans-serif",
            fontSize: "3px",
            letterSpacing: "0.02px",
            fontWeight: 600,
          }}
        >
          {labels.map((l) => {
            const PAD_X = 1.9;
            const PAD_Y = 1.4;
            const TEXT_H = 3;
            const textW = l.text.length * 1.55;
            const bubbleW = textW + PAD_X * 2;
            const bubbleH = TEXT_H + PAD_Y * 2;
            const anchor = l.anchor ?? "start";
            const tipX = l.px + l.dx * 0.45;
            const tipY = l.py + l.dy * 0.45;
            const bubbleX =
              anchor === "end"
                ? l.px + l.dx - bubbleW
                : l.px + l.dx;
            const bubbleY = l.py + l.dy - bubbleH / 2;
            const pointerBaseX =
              anchor === "end" ? bubbleX + bubbleW : bubbleX;
            const pointerBaseY = bubbleY + bubbleH / 2;
            const pointerTipX = tipX;
            const pointerTipY = tipY;
            const originX = pointerBaseX;
            const originY = pointerBaseY;
            return (
              <g
                key={l.i}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: `${originX}px ${originY}px`,
                  transform: l.visible ? "scale(1)" : "scale(0.25)",
                  opacity: l.visible ? 1 : 0,
                  transition: l.visible
                    ? "transform 420ms cubic-bezier(.34,1.7,.54,1), opacity 180ms ease-out"
                    : "transform 220ms cubic-bezier(.55,0,.7,.4), opacity 200ms ease-in",
                  filter:
                    "drop-shadow(0 0.45px 0.3px hsl(0 0% 0% / 0.22)) drop-shadow(0 1.2px 1.4px hsl(0 0% 0% / 0.28))",
                }}
              >
                <path
                  d={`M ${pointerBaseX} ${pointerBaseY - 0.85} L ${pointerTipX} ${pointerTipY} L ${pointerBaseX} ${pointerBaseY + 0.85} Z`}
                  fill="#ffffff"
                  stroke="hsl(28 25% 18% / 0.22)"
                  strokeWidth="0.1"
                />
                <rect
                  x={bubbleX}
                  y={bubbleY}
                  width={bubbleW}
                  height={bubbleH}
                  rx={bubbleH / 2}
                  ry={bubbleH / 2}
                  fill="#ffffff"
                  stroke="hsl(28 25% 18% / 0.22)"
                  strokeWidth="0.1"
                />
                <text
                  x={bubbleX + bubbleW / 2}
                  y={bubbleY + bubbleH / 2 + TEXT_H * 0.34}
                  textAnchor="middle"
                  fill="hsl(var(--ink))"
                >
                  {l.text}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

    </div>
  );
};

export default PartnersGlobe;
