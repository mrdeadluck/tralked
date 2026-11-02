import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { MissionsCard } from "@/components/character/MissionsCard";
import { SkillsWindow } from "@/components/character/SkillsWindow";
import { TrophyTiers } from "@/components/character/TrophyTiers";
import { XpBar } from "@/components/character/XpBar";
import {
  ExampleTag,
  OnboardingSteps,
  SAMPLE,
  SAMPLE_SKILLS,
  SampleCharacterCard,
} from "@/components/onboarding/SampleCharacter";
import type { CharacterMission } from "@/lib/queries/players";

export const metadata: Metadata = {
  title: "Seu personagem | Tralked",
  description:
    "Suas conquistas da Steam, PlayStation, Xbox e RetroAchievements viram XP, nível, platinas e skills por gênero numa ficha de personagem.",
};

/*
 * "Personagem" for visitors: what the character sheet is, shown with the real sheet components
 * filled with an EXAMPLE (labeled as such on every block), and the way in. Not a login wall.
 */

const SIGNUP_HREF = "/cadastrar";
const LOGIN_HREF = "/entrar?returnTo=%2Fjogador%2Fme";

const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[2px] border border-acc bg-acc px-6 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase transition-[filter] duration-150 hover:brightness-[1.08]";
const GHOST =
  "inline-flex h-12 items-center justify-center rounded-[2px] border border-line-2 px-6 font-mono text-xs font-bold tracking-[0.1em] text-text uppercase transition-colors duration-150 hover:border-text";

/** Sample missions: one done, two in progress (an example, like everything on this page). */
const SAMPLE_MISSIONS: CharacterMission[] = [
  { id: "m1", kind: "daily", title: "Desbloqueie 3 conquistas", progress: 3, goal: 3, rewardXp: 150, done: true },
  { id: "m2", kind: "daily", title: "Jogue um Soulslike por 1 hora", progress: 40, goal: 60, rewardXp: 120, done: false },
  { id: "m3", kind: "weekly", title: "Consiga uma conquista rara", progress: 0, goal: 1, rewardXp: 600, done: false },
];

const SAMPLE_TROPHIES = {
  tiers: { platinum: 12, gold: 148, silver: 391, bronze: 733 },
  byPlatform: [
    { platform: "steam" as const, unlocks: 702 },
    { platform: "psn" as const, unlocks: 455 },
    { platform: "xbox" as const, unlocks: 127 },
  ],
};

const GAINS: { title: string; body: string }[] = [
  { title: "Nível que sobe de verdade", body: "Cada conquista vale XP. A rara vale mais do que a comum." },
  { title: "Platinas e troféus juntos", body: "Steam, PlayStation, Xbox e RetroAchievements somam na mesma ficha." },
  { title: "Skills por gênero", body: "Zerou um Soulslike? A skill de Soulslike sobe. Mostre no que você é bom." },
];

export default function PersonagemPage() {
  return (
    <div className="flex flex-col gap-16">
      <section aria-labelledby="personagem-titulo" className="grid items-center gap-x-14 gap-y-10 min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="flex flex-col gap-7">
          <h1
            id="personagem-titulo"
            className="text-[clamp(34px,6vw,76px)] leading-[0.9] font-black font-stretch-[125%] tracking-[-0.04em] uppercase"
          >
            Suas conquistas viram <span className="text-acc">um personagem</span>
          </h1>
          <p className="max-w-[56ch] text-[18px] leading-relaxed text-text-2">
            Conecte a Steam, o PlayStation ou o Xbox e o Tralked monta a sua ficha: nível, platinas, missões e
            skills por gênero. Sem senha da plataforma, só o seu perfil público.
          </p>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {GAINS.map((gain) => (
              <li key={gain.title} className="flex items-start gap-3.5">
                <span aria-hidden="true" className="mt-[7px] size-2 flex-none bg-acc" />
                <span className="flex flex-col gap-0.5">
                  <b className="text-[16px] font-bold">{gain.title}</b>
                  <span className="text-[14.5px] text-muted">{gain.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link href={SIGNUP_HREF} className={PRIMARY}>
              Criar o meu personagem
            </Link>
            <Link href={LOGIN_HREF} className={GHOST}>
              Já tenho conta
            </Link>
          </div>
        </div>
        <SampleCharacterCard />
      </section>

      <section aria-labelledby="ficha-exemplo" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-text pb-4">
          <h2
            id="ficha-exemplo"
            className="text-[28px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase"
          >
            Por dentro da ficha
          </h2>
        </div>
        <p className="max-w-[68ch] text-[15px] text-muted">
          Os mesmos blocos da ficha de verdade, preenchidos com números de exemplo. Na sua, cada valor vem das
          conquistas que você desbloqueou.
        </p>

        <ExampleFrame label="Ficha de personagem">
          <div className="flex flex-col gap-10">
            <div>
              <div className="flex flex-wrap items-end gap-4 pb-4">
                <span className="text-[64px] leading-[0.8] font-black font-stretch-[125%] tracking-[-0.05em] text-acc tabular-nums">
                  {SAMPLE.level}
                </span>
                <b className="pb-1 text-lg font-extrabold font-stretch-[112%]">Nível do personagem</b>
              </div>
              <XpBar level={SAMPLE.level} current={6200} next={10000} />
            </div>
            <div className="grid gap-x-8 gap-y-6 min-[901px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <SkillsWindow skills={SAMPLE_SKILLS} />
              <div className="flex flex-col gap-5">
                <TrophyTiers trophies={SAMPLE_TROPHIES} />
                <MissionsCard missions={SAMPLE_MISSIONS} resetLabel="Exemplo" />
              </div>
            </div>
          </div>
        </ExampleFrame>
      </section>

      <section
        aria-labelledby="comecar"
        className="grid items-center gap-8 rounded-[4px] border border-line bg-surface p-6 sm:p-8 min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,480px)]"
      >
        <div className="flex flex-col gap-4">
          <h2
            id="comecar"
            className="text-[clamp(26px,3vw,36px)] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase"
          >
            Três passos até a sua ficha
          </h2>
          <p className="max-w-[48ch] text-[15px] text-text-2">
            A conta é grátis. Depois de conectar uma plataforma, a ficha se atualiza sozinha a cada sincronização.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href={SIGNUP_HREF} className={PRIMARY}>
              Criar conta
            </Link>
            <Link href={LOGIN_HREF} className={GHOST}>
              Entrar
            </Link>
          </div>
        </div>
        <OnboardingSteps />
      </section>
    </div>
  );
}

/** The sample sheet as an exhibit: a dashed display frame with the "Exemplo" tag on its edge. */
function ExampleFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={`${label} (exemplo)`} className="relative rounded-[4px] border border-dashed border-line-2 p-5 pt-8 sm:p-7 sm:pt-9">
      <ExampleTag className="absolute -top-3 left-4 bg-bg" />
      {children}
    </div>
  );
}
