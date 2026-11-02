import type { CSSProperties } from "react";
import { formatNumber } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { SkillIcon } from "@/components/character/SkillIcon";
import type { CharacterSkill } from "@/lib/queries/players";
import type { PlatformId } from "@/lib/engine/trophies";

/*
 * An EXAMPLE character sheet, for visitors (sign-up, login, the logged-out "Personagem"). Every
 * number here is illustrative and the card says so twice: the "Exemplo" tag and the caption.
 * Nothing on it claims to be a real player.
 */

export const SAMPLE = {
  name: "Sua ficha",
  handle: "seu_arroba",
  vocation: "Caçador de platinas",
  level: 34,
  /** Share of the current level already earned (0..1). */
  levelProgress: 0.62,
  platinums: 12,
  achievements: 1284,
  platforms: ["steam", "psn", "xbox"] as PlatformId[],
} as const;

export const SAMPLE_SKILLS: CharacterSkill[] = [
  { id: "soulslike", name: "Soulslike", level: 18, points: 720, need: 1000 },
  { id: "rpg", name: "RPG", level: 14, points: 410, need: 1000 },
  { id: "plataforma", name: "Plataforma", level: 11, points: 880, need: 1000 },
  { id: "horror", name: "Survival Horror", level: 9, points: 300, need: 1000 },
  { id: "roguelike", name: "Roguelike", level: 7, points: 560, need: 1000 },
  { id: "fps", name: "FPS", level: 4, points: 150, need: 1000 },
];

/** The example tag: lime-outlined, always on the card's first line. */
export function ExampleTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] border border-acc/60 px-2 py-0.5 font-mono text-xs font-bold tracking-[0.12em] text-acc uppercase ${className}`}
    >
      Exemplo
    </span>
  );
}

/** Level inside a progress ring: the arc is the way to the next level. */
export function LevelRing({ level, progress, size = 120 }: { level: number; progress: number; size?: number }) {
  const stroke = Math.round(size / 15);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const h = size / 2;
  const pct = Math.round(progress * 100);
  return (
    <div className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Nível ${level}, ${pct}% do caminho para o nível ${level + 1}`}
        className="absolute inset-0"
      >
        <circle cx={h} cy={h} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={h}
          cy={h}
          r={r}
          fill="none"
          stroke="var(--acc)"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${(c * progress).toFixed(1)} ${c.toFixed(1)}`}
          transform={`rotate(-90 ${h} ${h})`}
          className="transition-[stroke-dasharray] duration-[1200ms] ease-[cubic-bezier(.16,1,.3,1)] starting:[stroke-dasharray:0_1000]"
        />
      </svg>
      <span aria-hidden="true" className="relative flex flex-col items-center leading-none">
        <b className="font-black font-stretch-[125%] tracking-[-0.05em] text-acc tabular-nums" style={{ fontSize: size * 0.36 }}>
          {level}
        </b>
        <small className="mt-1 font-mono text-xs tracking-[0.14em] text-dim uppercase">Nível</small>
      </span>
    </div>
  );
}

function TrophyGlyph({ color, className = "" }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
    </svg>
  );
}

/** One skill line: icon, name, level and the bar to the next level. */
function SkillLine({ skill, top }: { skill: CharacterSkill; top: boolean }) {
  const fraction = Math.min(1, skill.points / skill.need);
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <SkillIcon name={skill.id} className={`size-4 flex-none ${top ? "text-acc" : "text-dim"}`} />
        <span className="text-[14px] font-semibold">{skill.name}</span>
        <span aria-hidden="true" className="min-w-3 flex-1 -translate-y-1 border-b-2 border-dotted border-[#34363f]" />
        <b className={`text-lg leading-none font-black font-stretch-[125%] tabular-nums ${top ? "text-acc" : ""}`}>
          <span className="sr-only">Nível </span>
          {skill.level}
        </b>
      </div>
      <div aria-hidden="true" className="ml-[26px] h-[3px] overflow-hidden rounded-[2px] bg-track">
        <i
          className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0"
          style={{ width: `${(fraction * 100).toFixed(1)}%` }}
        />
      </div>
    </li>
  );
}

/**
 * The example sheet as one card: level ring, platinums and achievements, the three strongest
 * skills and the connected platforms.
 */
export function SampleCharacterCard({ caption = true }: { caption?: boolean }) {
  return (
    <figure
      aria-label="Exemplo de ficha de personagem"
      className="relative m-0 flex flex-col gap-5 overflow-hidden rounded-[4px] border border-line-2 bg-surface p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,.9)] sm:p-6"
    >
      {/* A faint lime wash behind the ring: the card's one light source. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-20 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(198,244,50,.10),transparent)]"
      />
      <div className="relative flex items-center justify-between gap-3">
        <ExampleTag />
        <ul aria-label="Plataformas do exemplo" className="m-0 flex list-none gap-1.5 p-0">
          {SAMPLE.platforms.map((p) => (
            <li
              key={p}
              title={PLATFORM_LABEL[p]}
              className="inline-flex items-center gap-1.5 border border-line-2 px-1.5 py-0.5 font-mono text-xs tracking-[0.08em] text-(--c) uppercase"
              style={{ "--c": PLATFORM_TOKEN[p] } as CSSProperties}
            >
              <span aria-hidden="true" className="size-[5px] bg-(--c)" />
              {p === "steam" ? "Steam" : p === "psn" ? "PSN" : "Xbox"}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex items-center gap-5">
        <LevelRing level={SAMPLE.level} progress={SAMPLE.levelProgress} />
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <b className="block text-[24px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
              {SAMPLE.name}
            </b>
            <span className="mt-1.5 block font-mono text-xs tracking-[0.1em] text-acc uppercase">{SAMPLE.vocation}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <p className="flex items-center gap-2">
              <TrophyGlyph color="var(--plat)" className="size-5 flex-none" />
              <b className="text-[22px] leading-none font-black font-stretch-[112%] tabular-nums">{SAMPLE.platinums}</b>
              <span className="font-mono text-xs text-dim">platinas</span>
            </p>
            <p className="flex items-center gap-2">
              <b className="text-[22px] leading-none font-black font-stretch-[112%] tabular-nums">
                {formatNumber(SAMPLE.achievements)}
              </b>
              <span className="font-mono text-xs text-dim">conquistas</span>
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex flex-col gap-3 border-t border-divider pt-4">
        <span className="font-mono text-xs tracking-[0.12em] text-dim uppercase">Skills por gênero</span>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {SAMPLE_SKILLS.slice(0, 3).map((skill, i) => (
            <SkillLine key={skill.id} skill={skill} top={i === 0} />
          ))}
        </ul>
      </div>

      {caption ? (
        <figcaption className="relative text-[13px] text-muted">
          Ficha ilustrativa. A sua usa as conquistas reais das contas que você conectar.
        </figcaption>
      ) : null}
    </figure>
  );
}

const STEPS = [
  { title: "Crie a conta", body: "Nome, @, e-mail e uma senha só do Tralked." },
  { title: "Conecte Steam, PSN ou Xbox", body: "Só o seu perfil público. Nunca a senha da plataforma." },
  { title: "Veja o seu nível", body: "A ficha se monta sozinha com as suas conquistas, em poucos minutos." },
];

/** The three-step promise, as an ordered list (the sequence is the information). */
export function OnboardingSteps({ current }: { current?: 1 | 2 | 3 }) {
  return (
    <ol className="m-0 grid list-none gap-px overflow-hidden rounded-[3px] border border-line bg-line p-0">
      {STEPS.map((step, i) => {
        const n = i + 1;
        const active = current === n;
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className="flex items-start gap-3.5 bg-surface-2 px-4 py-3.5"
          >
            <span
              aria-hidden="true"
              className={`grid size-7 flex-none place-items-center rounded-[2px] font-mono text-xs font-bold ${
                active ? "bg-acc text-bg" : "border border-line-2 text-text-3"
              }`}
            >
              {n}
            </span>
            <span className="flex flex-col gap-0.5">
              <b className="text-[15px] font-bold">{step.title}</b>
              <span className="text-[13.5px] text-muted">{step.body}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
