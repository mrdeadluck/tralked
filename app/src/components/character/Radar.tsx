import type { ReactNode, SVGProps } from "react";

export type RadarPoint = { id: string; name: string; value: number };

type RadarProps = {
  points: RadarPoint[];
  /** Value at the outer ring. */
  max: number;
  /** The strongest point, drawn in lime. */
  topId: string | null;
  /** Accessible name of the chart ("Radar dos 9 atributos"). */
  label: string;
  /** Header of the value column of the fallback table ("Nível"). */
  valueLabel?: string;
  /** Icon at a tip, drawn as a nested <svg> at the given box. */
  renderIcon: (id: string, props: SVGProps<SVGSVGElement>) => ReactNode;
  className?: string;
};

const C = 170;
const R = 122;

const at = (i: number, n: number, r: number): [number, number] => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r];
};
const fmt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/**
 * Polygon (radar) chart, one axis per point, drawn on the server as SVG: graphite rings and axes,
 * the shape in lime, an icon and the value at each tip. Every tip and vertex carries `data-k` so a
 * RadarHover around it can link the chart to its list. A visually hidden table gives the numbers
 * to assistive tech.
 */
export function Radar({ points, max, topId, label, valueLabel = "Valor", renderIcon, className = "" }: RadarProps) {
  const n = points.length;
  if (n < 3) return null;
  const top = Math.max(1, max);
  const vertices = points.map((p, i) => at(i, n, Math.max(6, (R * Math.min(p.value, top)) / top)));
  return (
    <figure className={`m-0 ${className}`}>
      <svg viewBox="-22 -22 384 384" role="img" aria-label={label} className="block h-auto w-full overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon
            key={f}
            points={points.map((_, i) => fmt(at(i, n, R * f))).join(" ")}
            fill="none"
            stroke={f === 1 ? "var(--border-2)" : "var(--border)"}
          />
        ))}
        {points.map((p, i) => {
          const [x, y] = at(i, n, R);
          return <line key={p.id} x1={C} y1={C} x2={x} y2={y} stroke="var(--border)" />;
        })}
        <polygon
          points={vertices.map(fmt).join(" ")}
          fill="color-mix(in oklch, var(--acc) 22%, transparent)"
          stroke="var(--acc)"
          strokeWidth={2}
          strokeLinejoin="miter"
        />
        {vertices.map(([x, y], i) => (
          <rect
            key={points[i].id}
            data-k={points[i].id}
            x={x - 4}
            y={y - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})`}
            strokeWidth={2}
            className="fill-surface stroke-acc [&.hl]:fill-acc"
          />
        ))}
        {points.map((p, i) => {
          const [x, y] = at(i, n, R + 34);
          return (
            <g key={p.id} data-k={p.id}>
              <title>{`${p.name}: ${p.value}`}</title>
              {renderIcon(p.id, {
                x: x - 14,
                y: y - 23,
                width: 28,
                height: 28,
                className: `transition-colors duration-150 ${p.id === topId ? "text-acc" : "text-muted"} [.hl>&]:text-text`,
              })}
              <text
                x={x}
                y={y + 19}
                textAnchor="middle"
                className="fill-text text-[14px] font-extrabold tabular-nums"
              >
                {p.value}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.name}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A round outer value for the radar's scale: the next multiple of 10 above the highest value. */
export const radarMax = (values: number[]) => Math.max(10, Math.ceil(Math.max(0, ...values) / 10) * 10);
