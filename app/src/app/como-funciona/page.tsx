import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { SkillIcon } from "@/components/character/SkillIcon";
import {
  FORUM_SOLVED_XP,
  PHOTO_XP,
  PHOTO_XP_DAILY_CAP,
  REACTION_GIVEN_DAILY_CAP,
  REACTION_GIVEN_XP,
  REACTION_RECEIVED_DAILY_CAP,
  REACTION_RECEIVED_XP,
  TIP_VOTE_XP,
} from "@/lib/community/rewards";
import { DAILY_TEMPLATES, WEEKLY_TEMPLATES } from "@/lib/engine/missions";
import { PLAYTIME_MAX_GAMES, PLAYTIME_MIN_PAID_H, PLAYTIME_NEW_GAMES_PER_DAY, playtimeXp } from "@/lib/engine/playtime";
import { SKILLS } from "@/lib/engine/types";
import { expFor, xpForAchievement } from "@/lib/engine/xp";
import { NOVATO_MAX_LEVEL } from "@/lib/highscores/boards";
import { formatCompact, formatExact } from "@/lib/xp-format";

export const metadata: Metadata = {
  title: "Como funciona o XP | Tralked",
  description:
    "De onde vem o XP no Tralked, como sobem o nível e as habilidades, e como funcionam missões, sequência e rankings.",
};

// Every number on this page comes from the engine's own constants, so it can never drift.
const xpAt = (pct: number) => formatCompact(xpForAchievement(pct));
const range = (values: number[]) =>
  `${formatCompact(Math.min(...values))} a ${formatCompact(Math.max(...values))}`;
const dailyXp = DAILY_TEMPLATES.map((t) => t.rewardXp);
const weeklyXp = WEEKLY_TEMPLATES.map((t) => t.rewardXp);

type Source = {
  icon: string;
  name: string;
  text: ReactNode;
  /** The value shown big: "+50 XP", "+10%". */
  xp: string;
  /** Small word before it: "até", "desde". */
  prefix?: string;
  note?: string;
};

const PLAY: Source[] = [
  {
    icon: "trophy",
    name: "Conquistas",
    text: (
      <>
        Quanto mais rara, mais vale. Uma comum (50% dos jogadores têm) rende {xpAt(50)} XP; uma rara
        (10%), {xpAt(10)}; uma lendária (1%), {xpAt(1)}.
      </>
    ),
    prefix: "até",
    xp: `+${xpAt(0)} XP`,
    note: "por conquista",
  },
  {
    icon: "level",
    name: "Platina e 100%",
    text: "Completou o jogo? Ganha um bônus de 10% de todo o XP das conquistas dele.",
    xp: "+10%",
    note: "do XP do jogo",
  },
  {
    icon: "sync",
    name: "Horas jogadas",
    text: (
      <>
        A partir de {PLAYTIME_MIN_PAID_H} h em um jogo, cada marco paga uma vez: 10 h somam{" "}
        {formatCompact(playtimeXp(600))} XP, 100 h somam {formatCompact(playtimeXp(6000))}. Até{" "}
        {PLAYTIME_NEW_GAMES_PER_DAY} jogos novos por dia e {PLAYTIME_MAX_GAMES} no total.
      </>
    ),
    prefix: "desde",
    xp: `+${formatCompact(playtimeXp(PLAYTIME_MIN_PAID_H * 60))} XP`,
    note: "por jogo",
  },
  {
    icon: "mission",
    name: "Missões",
    text: `${DAILY_TEMPLATES.length} missões por dia e ${WEEKLY_TEMPLATES.length} por semana, pensadas para os gêneros que você mais joga.`,
    prefix: "até",
    xp: `+${formatCompact(Math.max(...dailyXp, ...weeklyXp))} XP`,
    note: "por missão",
  },
];

const COMMUNITY: Source[] = [
  {
    icon: "photo",
    name: "Foto na galeria",
    text: `Uma captura sua, marcada com o jogo. Vale para até ${PHOTO_XP_DAILY_CAP} fotos por dia.`,
    xp: `+${PHOTO_XP} XP`,
  },
  {
    icon: "sabio",
    name: "Resposta que resolveu",
    text: "Quem abriu o tópico no fórum marcou a sua resposta como a que resolveu. Vai para Sábio.",
    xp: `+${FORUM_SOLVED_XP} XP`,
  },
  {
    icon: "sabio",
    name: "Voto “útil” na sua dica",
    text: "Nas Dicas da comunidade de um guia, cada pessoa que marca a sua dica como útil. Também vai para Sábio.",
    xp: `+${TIP_VOTE_XP} XP`,
  },
  {
    icon: "like",
    name: "Receber uma curtida",
    text: `Alguém curtiu seu comentário (as dicas nos comentários do guia contam), foto, notícia ou guia. Até ${REACTION_RECEIVED_DAILY_CAP} por dia.`,
    xp: `+${REACTION_RECEIVED_XP} XP`,
  },
  {
    icon: "like",
    name: "Reagir",
    text: `Curtir ou não curtir algo dos outros. Uma vez por item, até ${REACTION_GIVEN_DAILY_CAP} por dia.`,
    xp: `+${REACTION_GIVEN_XP} XP`,
  },
];

const LADDER = [2, 10, 25, 50, 100, 150];

export default function ComoFuncionaPage() {
  const maxLadder = expFor(LADDER[LADDER.length - 1]);
  return (
    <article className="flex w-full flex-col gap-14">
      <header className="flex flex-col gap-4 border-b-2 border-text pb-6">
        <h1 className="text-[clamp(34px,5vw,56px)] leading-[0.95] font-black font-stretch-[125%] tracking-[-0.035em] uppercase">
          Como funciona o XP
        </h1>
        <p className="max-w-[62ch] text-[17px] text-text-2">
          Tudo o que você joga vira XP na sua ficha. O XP sobe o nível do personagem, treina as suas
          habilidades e te coloca nos rankings. Conquistas e horas vêm direto das plataformas: nada de atalho.
        </p>
        <nav aria-label="Nesta página" className="flex flex-wrap gap-2 pt-1">
          {[
            ["#de-onde-vem", "De onde vem"],
            ["#nivel", "Nível"],
            ["#habilidades", "Habilidades"],
            ["#missoes-e-sequencia", "Missões e sequência"],
            ["#rankings", "Rankings"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center rounded-[2px] border border-line-2 px-3.5 font-mono text-xs tracking-[0.06em] text-text-3 uppercase hover:border-text hover:text-text"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="de-onde-vem" title="De onde vem">
        <p className="max-w-[64ch] text-[15.5px] text-muted">
          A maior parte do XP vem de jogar: conquistas, platinas e horas, lidas das suas contas Steam,
          PlayStation, Xbox e RetroAchievements a cada sincronização. A comunidade rende menos, mas rende
          todo dia.
        </p>
        <div className="grid gap-6 min-[860px]:grid-cols-2">
          <LootTable caption="Jogando" sources={PLAY} />
          <LootTable caption="Na comunidade" sources={COMMUNITY} />
        </div>
        <p className="text-[14px] text-dim">
          Cada ganho aparece na hora, no canto da tela: <b className="font-mono text-acc">+5 XP · Curtida</b>.
        </p>
      </Section>

      <Section id="nivel" title="Nível">
        <div className="grid items-start gap-8 min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-3 text-[15.5px] text-muted">
            <p>
              Cada nível pede mais XP que o anterior. No começo você sobe rápido; depois, cada nível é
              uma conquista em si. Por isso a sua ficha mostra o nível e quanto falta para o próximo, e
              não o total em milhões.
            </p>
            <p>
              Quer disputar com quem está começando? O ranking <b className="text-text">Novatos</b> reúne
              só jogadores até o nível {NOVATO_MAX_LEVEL}.
            </p>
          </div>
          <ol aria-label="XP total para alguns níveis" className="m-0 flex list-none flex-col gap-2.5 p-0">
            {LADDER.map((level) => {
              const xp = expFor(level);
              // Square root scale: the early levels stay visible next to level 150.
              const width = Math.max(3, Math.sqrt(xp / maxLadder) * 100);
              return (
                <li key={level} className="grid grid-cols-[72px_minmax(0,1fr)_92px] items-center gap-3">
                  <span className="font-mono text-xs text-dim">
                    Nível <b className="text-[15px] font-black text-text tabular-nums">{level}</b>
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-[2px] bg-track">
                    <i className="block h-full bg-acc" style={{ width: `${width}%` }} />
                  </span>
                  <span
                    className="text-right font-mono text-xs text-text-3 tabular-nums"
                    title={`${formatExact(xp)} XP`}
                  >
                    {formatCompact(xp)} XP
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </Section>

      <Section id="habilidades" title="Habilidades">
        <p className="max-w-[64ch] text-[15.5px] text-muted">
          Cada jogo treina as habilidades do seu gênero: um soulslike treina Soulslike, um RPG cooperativo
          treina RPG e Co-op. Elas sobem de nível sozinhas e decidem a sua vocação. Sábio é a exceção:
          cresce ajudando os outros, com guias, respostas e dicas.
        </p>
        <ul className="m-0 grid list-none grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line p-0 min-[560px]:grid-cols-3 min-[860px]:grid-cols-4">
          {SKILLS.map((skill) => (
            <li key={skill.id} className="flex items-center gap-3 bg-surface px-4 py-3.5">
              <span
                aria-hidden="true"
                className={`grid size-10 flex-none place-items-center rounded-[2px] ${
                  skill.id === "sabio" ? "bg-[color-mix(in_srgb,var(--acc)_14%,transparent)] text-acc" : "bg-hover-2 text-text-2"
                }`}
              >
                <SkillIcon name={skill.id} className="size-5" />
              </span>
              <span className="text-[15px] font-bold">{skill.name}</span>
            </li>
          ))}
          <li className="flex items-center bg-surface px-4 py-3.5 text-[13.5px] text-muted">
            A vocação vem das mais treinadas.
          </li>
        </ul>
      </Section>

      <Section id="missoes-e-sequencia" title="Missões e sequência">
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <Panel icon="mission" title="Missões" color="var(--acc)">
            <p>
              Todo dia surgem {DAILY_TEMPLATES.length} missões ({range(dailyXp)} XP cada) e toda semana mais{" "}
              {WEEKLY_TEMPLATES.length} ({range(weeklyXp)} XP). Elas seguem os gêneros que você mais
              joga e se completam sozinhas quando a sincronização encontra as conquistas certas.
            </p>
          </Panel>
          <Panel icon="streak" title="Sequência" color="var(--pc)">
            <p>
              Cada dia com pelo menos uma conquista soma um dia à sequência. A cada 7 dias seguidos você
              ganha um escudo (no máximo 2), que cobre um dia sem jogar. Se a sequência estiver por um
              fio, o sino te avisa logo cedo.
            </p>
          </Panel>
        </div>
      </Section>

      <Section id="rankings" title="Rankings">
        <div className="flex flex-col gap-4 text-[15.5px] text-muted">
          <p className="max-w-[64ch]">
            O ranking de <b className="text-text">Nível</b> é o geral. Para disputar desde já, olhe{" "}
            <b className="text-text">Esta semana</b> (XP dos últimos 7 dias, inclusive o da comunidade: o nível não
            importa) e{" "}
            <b className="text-text">Novatos</b> (até o nível {NOVATO_MAX_LEVEL}). Há também rankings de
            horas, conquistas, raras, platinas, acervo e um por gênero. Se alguém te passar, o sino avisa.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/highscores/semana"
              className="inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
            >
              Ver Esta semana
            </Link>
            <Link
              href="/highscores"
              className="inline-flex h-11 items-center rounded-[2px] border border-line-2 px-[18px] font-mono text-xs tracking-[0.1em] text-text uppercase hover:border-text"
            >
              Todos os rankings
            </Link>
          </div>
        </div>
      </Section>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="flex scroll-mt-24 flex-col gap-5">
      <h2
        id={`${id}-titulo`}
        className="text-[clamp(24px,3vw,32px)] leading-none font-black font-stretch-[125%] tracking-[-0.025em] uppercase"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** XP sources as a loot table: icon, what you do, what it pays. */
function LootTable({ caption, sources }: { caption: string; sources: Source[] }) {
  return (
    <div className="rounded-[4px] border border-line bg-surface">
      <h3 className="border-b border-line px-5 py-3.5 font-mono text-xs tracking-[0.12em] text-dim uppercase">
        {caption}
      </h3>
      <ul className="m-0 list-none p-0">
        {sources.map((source) => (
          <li
            key={source.name}
            className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2 min-[480px]:grid-cols-[40px_minmax(0,1fr)_auto] border-b border-divider px-5 py-4 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-[2px] bg-[color-mix(in_srgb,var(--acc)_12%,transparent)] text-acc"
            >
              <SkillIcon name={source.icon} className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <b className="text-[15.5px] font-bold">{source.name}</b>
              <span className="text-[14px] text-muted">{source.text}</span>
            </span>
            <span className="col-start-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-[480px]:col-start-auto min-[480px]:flex-col min-[480px]:flex-nowrap min-[480px]:items-end min-[480px]:pt-0.5 min-[480px]:text-right">
              {source.prefix ? <small className="font-mono text-xs text-dim">{source.prefix}</small> : null}
              <b className="font-mono text-[15px] font-bold whitespace-nowrap text-acc tabular-nums">{source.xp}</b>
              {source.note ? <small className="font-mono text-xs text-dim">{source.note}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ icon, title, color, children }: { icon: string; title: string; color: string; children: ReactNode }) {
  return (
    <div
      style={{ "--c": color } as CSSProperties}
      className="flex flex-col gap-3 rounded-[4px] border border-line bg-surface p-5 text-[15px] text-muted"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-[2px] bg-[color-mix(in_srgb,var(--c)_14%,transparent)] text-(--c)"
        >
          <SkillIcon name={icon} className="size-5" />
        </span>
        <h3 className="text-[18px] font-black font-stretch-[112%] text-text uppercase">{title}</h3>
      </span>
      {children}
    </div>
  );
}
