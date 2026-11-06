import { useId } from "react";

/** Sky and ridge hues of the generated art for known games (same palette as the approved preview). */
const GAME_HUES: Record<string, [number, number]> = {
  "hollow-knight": [218, 250],
  celeste: [318, 268],
  hades: [352, 22],
  "elden-ring": [42, 18],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG, so the server render and hydration draw the same art. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hueFor(gameSlug: string | null | undefined): [number, number] {
  // Own keys only: a slug such as "constructor" must not read Object.prototype.
  if (gameSlug && Object.hasOwn(GAME_HUES, gameSlug)) return GAME_HUES[gameSlug];
  const h = hash(gameSlug ?? "tralked");
  const h1 = h % 360;
  return [h1, (h1 + 30 + ((h >>> 9) % 60)) % 360];
}

type PhotoArtProps = {
  /** Anything stable (the photo id): the same seed always draws the same picture. */
  seed: string;
  gameSlug?: string | null;
  width: number;
  height: number;
  className?: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Generated landscape art for example photos without an image file (seed data). Pure SVG, so it
 * renders on the server, needs no JavaScript and is identical on every load.
 */
export function PhotoArt({ seed, gameSlug, width, height, className = "" }: PhotoArtProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const r = rng(hash(seed));
  const [h1, h2] = hueFor(gameSlug);
  const w = 400;
  const h = Math.round((w * height) / Math.max(1, width));
  const light = r() < 0.4;
  const figure = r() < 0.5;
  const gx = w * (0.25 + r() * 0.5);
  const gy = h * (0.18 + r() * 0.25);

  const stars = Array.from({ length: 48 }, () => ({
    x: r1(r() * w),
    y: r1(r() * h * 0.8),
    s: r1(r() * 2.2 + 0.4),
    o: r1(r() * 0.5),
  }));

  const ridges = Array.from({ length: 4 }, (_, layer) => {
    const base = h * (0.52 + layer * 0.12);
    const amp = h * (0.16 - layer * 0.025);
    const points: string[] = [`0,${h}`];
    let x = 0;
    while (x <= w) {
      const spire = r() < 0.12 ? amp * (1.4 + r()) : amp * r();
      points.push(`${r1(x)},${r1(base - spire)}`);
      x += w * (0.025 + r() * 0.05);
    }
    points.push(`${w},${h}`);
    return { points: points.join(" "), fill: `hsl(${h2} ${30 + layer * 5}% ${14 - layer * 3}%)` };
  });

  const fx = w * (0.38 + r() * 0.24);
  const fy = h * 0.78;
  const fs = h * 0.06;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      className={`block size-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${h1} 42% ${light ? 30 : 20}%)`} />
          <stop offset="0.55" stopColor={`hsl(${h2} 45% 11%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 55% 4%)`} />
        </linearGradient>
        <radialGradient id={`${uid}g`} cx={r1(gx)} cy={r1(gy)} r={r1(Math.max(w, h) * 0.6)} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={`hsl(${h1} 80% 72%)`} stopOpacity="0.55" />
          <stop offset="0.35" stopColor={`hsl(${h1} 70% 50%)`} stopOpacity="0.15" />
          <stop offset="1" stopColor={`hsl(${h1} 70% 50%)`} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}l`}>
          <stop offset="0" stopColor="hsl(48 100% 75%)" stopOpacity="0.9" />
          <stop offset="1" stopColor="hsl(48 100% 75%)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}v`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.4" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${uid}s)`} />
      <rect width={w} height={h} fill={`url(#${uid}g)`} />
      {stars.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.s} height={s.s} fill={`hsl(${h1} 80% 85%)`} opacity={s.o} />
      ))}
      {ridges.map((ridge, i) => (
        <polygon key={i} points={ridge.points} fill={ridge.fill} />
      ))}
      {figure ? (
        <g fill={`hsl(${h2} 40% 3%)`}>
          <circle cx={r1(fx + fs * 0.6)} cy={r1(fy - fs * 0.4)} r={r1(fs * 3)} fill={`url(#${uid}l)`} />
          <polygon points={`${r1(fx - fs * 0.45)},${r1(fy)} ${r1(fx)},${r1(fy - fs * 1.5)} ${r1(fx + fs * 0.45)},${r1(fy)}`} />
          <circle cx={r1(fx)} cy={r1(fy - fs * 1.6)} r={r1(fs * 0.3)} />
          <circle cx={r1(fx + fs * 0.6)} cy={r1(fy - fs * 0.4)} r={r1(fs * 0.12)} fill="hsl(48 100% 80%)" />
        </g>
      ) : null}
      <rect width={w} height={h} fill={`url(#${uid}v)`} />
    </svg>
  );
}
