import Link from "next/link";
import type { ReactNode } from "react";
import { RemoteImg } from "@/components/ui/RemoteImg";
import type { HomePlayer } from "@/lib/queries/home-player";
import { LevelRing } from "./LevelRing";

/*
 * "Sua partida": the top of the home for a signed-in player. Level gauge, the game closest to
 * 100%, today's mission, the streak and the rank, in one compact band above the news. Every cell
 * links to where that number lives. Logged-out visitors get InviteStrip instead.
 */

/** 420_000 -> "420 mil", 1_250_000 -> "1,3 mi" (short and true, for "faltam … XP"). */
export function shortXp(xp: number): string {
  if (xp >= 1_000_000) return `${(xp / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (xp >= 10_000) return `${Math.round(xp / 1_000).toLocaleString("pt-BR")} mil`;
  return xp.toLocaleString("pt-BR");
}

const cell = "flex min-w-0 items-center gap-3.5 bg-surface px-4 py-3.5 transition-colors hover:bg-hover focus-visible:bg-hover";
const label = "font-mono text-xs tracking-[0.08em] text-muted uppercase";

function Bar({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
      <span className="block h-full rounded-full bg-acc" style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
    </span>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className={`inline size-2.5 ${up ? "" : "rotate-180"}`}>
      <path d="M5 1.5 9 7.5H1z" fill="currentColor" />
    </svg>
  );
}

function Cell({ href, className = "", children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${cell} ${className}`}>
      {children}
    </Link>
  );
}

export function PlayerStrip({ player }: { player: HomePlayer }) {
  const { closest, mission, streak, rank } = player;
  const me = `/jogador/${player.handle}`;

  const level = (
    <Cell href={me} className="order-1 col-span-2 lg:order-none lg:col-span-1">
      <LevelRing level={player.level} pct={player.levelPct} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={label}>Nível {player.level}</span>
        <span className="text-[17px] leading-tight font-extrabold whitespace-nowrap">
          {player.levelPct}% <span className="font-semibold text-text-2">até o {player.level + 1}</span>
        </span>
        <span className="font-mono text-xs text-muted">
          {player.started ? `faltam ${shortXp(player.xpToNext)} XP` : "conecte uma conta para ganhar XP"}
        </span>
      </span>
    </Cell>
  );

  if (!player.started) {
    return (
      <Strip>
        {level}
        <div className="order-2 col-span-2 flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3.5 lg:col-span-4">
          <p className="max-w-[56ch] text-[15px] text-text-2">
            Conecte Steam, PlayStation, Xbox ou RetroAchievements: suas conquistas viram XP, missões e posição no
            ranking.
          </p>
          <Link
            href="/conta/conexoes"
            className="inline-flex min-h-11 items-center rounded-[2px] bg-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:bg-text"
          >
            Conectar contas
          </Link>
        </div>
      </Strip>
    );
  }

  return (
    <Strip>
      {level}

      {closest ? (
        <Cell href={`/jogos/${closest.slug}`} className="order-3 lg:order-none">
          {closest.coverUrl ? (
            <RemoteImg
              url={closest.coverUrl}
              alt=""
              width={40}
              height={54}
              sizes="40px"
              shape="fit"
              className="aspect-[3/4] w-10 flex-none rounded-[1px_3px_3px_1px] object-cover shadow-[-3px_0_0_#0d0e12,0_8px_14px_-6px_rgba(0,0,0,.8)]"
            />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={label}>
              <span className="sm:hidden">Quase 100%</span>
              <span className="max-sm:hidden">Mais perto dos 100%</span>
            </span>
            <span className="truncate text-[15px] leading-tight font-bold">{closest.name}</span>
            <span className="flex items-center gap-2 font-mono text-xs text-muted">
              <b className="font-bold text-acc">{closest.pct}%</b>
              <span className="truncate">
                faltam {closest.total - closest.unlocked}
                <span className="max-sm:hidden"> {closest.total - closest.unlocked === 1 ? "conquista" : "conquistas"}</span>
              </span>
            </span>
          </span>
        </Cell>
      ) : (
        <Cell href="/jogos" className="order-3 lg:order-none">
          <span className="flex min-w-0 flex-col gap-1">
            <span className={label}>Mais perto dos 100%</span>
            <span className="text-[14px] text-text-2">Desbloqueie conquistas e o jogo aparece aqui.</span>
          </span>
        </Cell>
      )}

      <Cell href={me} className="order-4 lg:order-none">
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={`${label} flex justify-between gap-2`}>
            <span>{mission?.allDone ? "Missões de hoje" : "Missão de hoje"}</span>
            {mission ? (
              <b className="font-bold text-acc normal-case max-sm:hidden">+{mission.rewardXp.toLocaleString("pt-BR")} XP</b>
            ) : null}
          </span>
          {mission ? (
            <>
              <span className="line-clamp-2 text-[14px] leading-snug font-semibold">
                {mission.allDone ? "Todas feitas. Novas amanhã." : mission.title}
              </span>
              <span className="flex items-center gap-2">
                <Bar value={(mission.progress / mission.goal) * 100} />
                <span className="flex-none font-mono text-xs text-muted tabular-nums">
                  {mission.progress}/{mission.goal}
                </span>
              </span>
              <b className="font-mono text-xs font-bold text-acc sm:hidden">+{mission.rewardXp.toLocaleString("pt-BR")} XP</b>
            </>
          ) : (
            <span className="text-[14px] text-text-2">Novas missões chegam com a próxima sincronização.</span>
          )}
        </span>
      </Cell>

      <>
        <Cell href={me} className="order-2 lg:order-none">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={label}>Sequência</span>
            <span className="text-[17px] leading-tight font-extrabold tabular-nums">
              {streak.current} {streak.current === 1 ? "dia" : "dias"}
            </span>
            <span className={`font-mono text-xs ${streak.activeToday ? "text-acc" : "text-muted"}`}>
              {streak.activeToday ? "garantida hoje" : streak.current > 0 ? "conquiste algo hoje" : "comece hoje"}
            </span>
          </span>
        </Cell>
        <Cell href={rank ? "/highscores" : "/conta"} className="order-2 lg:order-none">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={label}>Ranking</span>
            {rank ? (
              <>
                <span className="flex items-baseline gap-2 text-[17px] leading-tight font-extrabold tabular-nums">
                  #{rank.position.toLocaleString("pt-BR")}
                  {rank.delta ? (
                    <span className={`font-mono text-xs font-bold ${rank.delta > 0 ? "text-acc" : "text-text-2"}`}>
                      <Arrow up={rank.delta > 0} /> {Math.abs(rank.delta)}
                      <span className="sr-only"> {rank.delta > 0 ? "posições acima" : "posições abaixo"} desde ontem</span>
                    </span>
                  ) : null}
                </span>
                <span className="truncate font-mono text-xs text-muted">
                  {rank.passedBy ? (
                    <>
                      <b className="font-bold text-text">@{rank.passedBy}</b> te passou
                    </>
                  ) : rank.above ? (
                    <>
                      próximo: <b className="font-medium text-text-2">@{rank.above}</b>
                    </>
                  ) : (
                    "você lidera"
                  )}
                </span>
              </>
            ) : (
              <span className="text-[13px] leading-snug text-text-2">
                {player.profilePublic ? "Fora do ranking por enquanto" : "Perfil privado: fora do ranking"}
              </span>
            )}
          </span>
        </Cell>
      </>
    </Strip>
  );
}

function Strip({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Sua partida"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,.7fr)_minmax(0,.85fr)]"
    >
      {children}
    </section>
  );
}

/** Logged-out visitors: one invitation, not a wall. */
export function InviteStrip() {
  return (
    <section
      aria-labelledby="convite-personagem"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-[4px] border border-line bg-surface px-5 py-4"
    >
      {/* A sample of the gauge the player gets: the level is theirs to find out. */}
      <span className="flex flex-none items-center max-sm:hidden">
        <LevelRing level="?" caption="NV" pct={68} size={64} />
      </span>
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <h2 id="convite-personagem" className="text-[21px] leading-tight font-black font-stretch-[112%] tracking-[-0.02em]">
          Seu personagem gamer em poucos minutos
        </h2>
        <p className="max-w-[64ch] text-[14.5px] text-text-2">
          Conecte Steam, PlayStation, Xbox ou RetroAchievements: cada conquista vira XP, nível e posição no ranking.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
        <Link
          href="/cadastrar"
          className="inline-flex min-h-11 items-center justify-center rounded-[2px] bg-acc px-5 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:bg-text max-sm:flex-1"
        >
          Criar meu personagem
        </Link>
        {/* On phones the header's own "Entrar" button is right above. */}
        <Link
          href="/entrar?returnTo=%2F"
          className="inline-flex min-h-11 items-center px-3 font-mono text-xs tracking-[0.08em] text-text-2 uppercase hover:text-acc max-sm:hidden"
        >
          Já tenho conta
        </Link>
      </div>
    </section>
  );
}
