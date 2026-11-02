import type { CSSProperties } from "react";

/*
 * The level gauge of "Sua partida": a segmented ring (an XP meter, not a pie) whose lime arc
 * fills to the progress inside the level once, when the home opens. Reduced motion: drawn full.
 * The stylesheet sits beside the <svg>, not inside it: React only hoists (and dedupes) a
 * <style precedence> in the HTML namespace.
 */

const CSS = `
.lvr-arc { stroke-dasharray: var(--len) var(--c); animation: lvr-fill 1.1s cubic-bezier(.16,1,.3,1) .15s both; }
@keyframes lvr-fill { from { stroke-dasharray: 0 var(--c); } }
@media (prefers-reduced-motion: reduce) { .lvr-arc { animation: none; } }
`;

export function LevelRing({
  level,
  pct,
  size = 64,
  caption,
}: {
  /** What the centre reads: the level, or "?" on the visitor's sample ring. */
  level: number | string;
  pct: number;
  size?: number;
  /** Small line above the number ("NV"). */
  caption?: string;
}) {
  const stroke = Math.round(size / 11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const h = size / 2;
  const segments = 36;
  const seg = c / segments;
  const long = typeof level === "number" && level >= 100;
  const fontSize = Math.round(size * (long ? 0.3 : 0.36));
  return (
    <>
      <style href="tralked-level-ring" precedence="default">
        {CSS}
      </style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="flex-none">
        <circle
          cx={h}
          cy={h}
          r={r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={stroke}
          strokeDasharray={`${seg * 0.62} ${seg * 0.38}`}
        />
        <circle
          className="lvr-arc"
          cx={h}
          cy={h}
          r={r}
          fill="none"
          stroke="var(--acc)"
          strokeWidth={stroke}
          transform={`rotate(-90 ${h} ${h})`}
          style={{ "--len": `${(c * Math.max(0, Math.min(100, pct))) / 100}px`, "--c": `${c}px` } as CSSProperties}
        />
        {caption ? (
          <text
            x="50%"
            y={h - fontSize * 0.55}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--muted)"
            style={{ fontSize: Math.max(9, Math.round(size * 0.15)), fontWeight: 700, letterSpacing: "0.08em" }}
          >
            {caption}
          </text>
        ) : null}
        <text
          x="50%"
          y={caption ? h + fontSize * 0.28 : "50%"}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text)"
          style={{ fontSize, fontWeight: 900, fontStretch: "125%" }}
        >
          {level}
        </text>
      </svg>
    </>
  );
}
