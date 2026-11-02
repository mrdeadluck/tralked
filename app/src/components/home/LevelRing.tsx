import type { CSSProperties } from "react";

/*
 * The level gauge of "Sua partida": a segmented ring (an XP meter, not a pie) whose lime arc
 * fills to the progress inside the level once, when the home opens. Reduced motion: drawn full.
 */

const CSS = `
.lvr-arc { stroke-dasharray: var(--len) var(--c); animation: lvr-fill 1.1s cubic-bezier(.16,1,.3,1) .15s both; }
@keyframes lvr-fill { from { stroke-dasharray: 0 var(--c); } }
@media (prefers-reduced-motion: reduce) { .lvr-arc { animation: none; } }
`;

export function LevelRing({ level, pct, size = 64 }: { level: number; pct: number; size?: number }) {
  const stroke = Math.round(size / 11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const h = size / 2;
  const segments = 36;
  const seg = c / segments;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="flex-none">
      <style href="tralked-level-ring" precedence="default">
        {CSS}
      </style>
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
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text)"
        style={{ fontSize: Math.round(size * (level >= 100 ? 0.3 : 0.36)), fontWeight: 900, fontStretch: "125%" }}
      >
        {level}
      </text>
    </svg>
  );
}
