type RingProps = {
  /** 0..100 */
  value: number;
  size?: number;
};

export function Ring({ value, size = 44 }: RingProps) {
  const pct = Math.min(100, Math.max(0, value));
  const stroke = Math.max(3, Math.round(size / 11));
  // 12px floor: the percentage is functional text even inside the smallest ring.
  const fontSize = Math.max(12, Math.round(size / 4));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const h = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${Math.round(pct)}% concluído`}
      className="flex-none"
    >
      <circle
        cx={h}
        cy={h}
        r={r}
        fill="none"
        stroke="var(--track)"
        strokeWidth={stroke}
      />
      <circle
        cx={h}
        cy={h}
        r={r}
        fill="none"
        stroke="var(--acc)"
        strokeWidth={stroke}
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform={`rotate(-90 ${h} ${h})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text)"
        style={{ fontSize, fontWeight: 700 }}
        className="font-mono"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}
