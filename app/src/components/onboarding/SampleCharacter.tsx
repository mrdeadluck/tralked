import type { CSSProperties } from "react";
import { formatNumber } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { SkillIcon } from "@/components/character/SkillIcon";
import type { CharacterSkill } from "@/lib/queries/players";
import type { PlatformId } from "@/lib/engine/trophies";
import { levelFromXp, xpForAchievement } from "@/lib/engine/xp";

/*
 * An EXAMPLE character sheet, for visitors (sign-up, login, the logged-out "Personagem"). Every
 * number here is illustrative and the card says so twice: the "Exemplo" tag and the caption.
 * Nothing on it claims to be a real player. The level and the XP still come from the engine's own
 * formulas (an example player with these unlocks would be exactly here), so the sample never
 * contradicts /como-funciona or a real sheet.
 */

/** The example's unlocks by global unlock %: 1.284 in all, the same as its trophy tiers. */
const SAMPLE_UNLOCKS: [count: number, globalPct: number][] = [
  [733, 60],
  [391, 25],
  [148, 10],
  [12, 2],
];

/** XP of the example's unlocks, by the real achievement formula. */
export const SAMPLE_TOTAL_XP = SAMPLE_UNLOCKS.reduce((sum, [count, pct]) => sum + count * xpForAchievement(pct), 0);

/** Where that XP puts the example: level, XP inside the level and what the level spans. */
export const SAMPLE_PROGRESS = levelFromXp(SAMPLE_TOTAL_XP);

export const SAMPLE = {
  name: "Sua ficha",
  handle: "seu_arroba",
  vocation: "Caçador de platinas",
  level: SAMPLE_PROGRESS.level,
  /** Share of the current level already earned (0..1). */
  levelProgress: SAMPLE_PROGRESS.fraction,
  platinums: 12,
  achievements: SAMPLE_UNLOCKS.reduce((sum, [count]) => sum + count, 0),
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
      className={`inline-flex items-center gap-1.5 border border-acc/60 px-2 py-0.5 text-xs font-extrabold font-stretch-[80%] tracking-[0.08em] text-acc uppercase ${className}`}
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
        <small className="mt-1 tk-lbl">Nível</small>
      </span>
    </div>
  );
}

/** The example's level as on a real header: the number, a segmented bar and the share of the level. */
function SampleLevelPlate() {
  const pct = Math.floor(SAMPLE.levelProgress * 100);
  return (
    <div
      role="img"
      aria-label={`Nível ${SAMPLE.level}, ${pct}% do caminho para o nível ${SAMPLE.level + 1}`}
      className="flex w-[118px] flex-none flex-col gap-2 bg-bg p-3 shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <span className="tk-lbl">Nível</span>
      <b className="text-[44px] leading-[0.85] font-black font-stretch-[125%] tracking-[-0.04em] tabular-nums">{SAMPLE.level}</b>
      <span className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={`h-1.5 flex-1 ${i < Math.floor(SAMPLE.levelProgress * 10) ? "bg-acc" : "bg-track"}`} />
        ))}
      </span>
      <small className="text-xs text-muted tabular-nums">{pct}% do {SAMPLE.level + 1}</small>
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
        <span aria-hidden="true" className={`grid size-7 flex-none place-items-center tk-cut-sm ${top ? "bg-moss text-acc" : "bg-track text-text-2"}`}>
          <SkillIcon name={skill.id} className="size-[18px]" />
        </span>
        <span className="flex-1 text-[14px] font-bold">{skill.name}</span>
        <b className={`text-lg leading-none font-black font-stretch-[125%] tabular-nums ${top ? "text-acc" : ""}`}>
          <span className="sr-only">Nível </span>
          {skill.level}
        </b>
      </div>
      <div aria-hidden="true" className="ml-[38px] h-1 overflow-hidden bg-track">
        <i
          className={`block h-full ${top ? "bg-acc" : "bg-acc-dim"} transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0`}
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
      className="relative m-0 flex flex-col gap-5 overflow-hidden bg-surface p-5 tk-cut shadow-[0_30px_60px_-30px_rgba(0,0,0,.9)] before:absolute before:top-0 before:right-[10px] before:left-0 before:h-[2px] before:bg-acc before:content-[''] sm:p-6"
    >
      <div className="relative flex items-center justify-between gap-3">
        <ExampleTag />
        <ul aria-label="Plataformas do exemplo" className="m-0 flex list-none gap-1.5 p-0">
          {SAMPLE.platforms.map((p) => (
            <li
              key={p}
              title={PLATFORM_LABEL[p]}
              className="inline-flex min-h-6 items-center gap-1.5 bg-track px-2 text-xs font-bold font-stretch-[80%] tracking-[0.06em] text-text-2 uppercase"
              style={{ "--c": PLATFORM_TOKEN[p] } as CSSProperties}
            >
              <span aria-hidden="true" className="size-1.5 bg-(--c)" />
              {p === "steam" ? "Steam" : p === "psn" ? "PSN" : "Xbox"}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex items-center gap-5">
        <SampleLevelPlate />
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <b className="block text-[24px] leading-none font-black font-stretch-[118%] tracking-[-0.03em]">
              {SAMPLE.name}
            </b>
            <span className="mt-1.5 block text-sm font-bold text-acc">{SAMPLE.vocation}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <p className="flex items-center gap-2">
              <TrophyGlyph color="var(--plat)" className="size-5 flex-none" />
              <b className="text-[22px] leading-none font-black font-stretch-[112%] tabular-nums">{SAMPLE.platinums}</b>
              <span className="text-[13px] text-muted">platinas</span>
            </p>
            <p className="flex items-center gap-2">
              <b className="text-[22px] leading-none font-black font-stretch-[112%] tabular-nums">
                {formatNumber(SAMPLE.achievements)}
              </b>
              <span className="text-[13px] text-muted">conquistas</span>
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex flex-col gap-3 border-t border-divider pt-4">
        <span className="tk-lbl">Skills por gênero</span>
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
    <ol className="m-0 grid list-none gap-0.5 p-0">
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
              className={`grid size-7 flex-none place-items-center text-sm font-black font-stretch-[112%] tk-cut-sm ${
                active ? "bg-acc text-acc-ink" : "bg-track text-text-2"
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
