import Link from "next/link";
import type { CSSProperties } from "react";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { PlayerGamePlatforms, PlatformTrophies } from "@/lib/queries/game-profile";

const fmt = (n: number) => n.toLocaleString("pt-BR");

type Card = {
  id: string;
  label: string;
  color: string | null;
  unlocked: number;
  total: number;
  pct: number;
  badge: string | null;
  trophies: PlatformTrophies;
  href: string;
  best: boolean;
};

/**
 * A player's progress in one game, by platform (/jogador/<handle>/conquistas?jogo=<slug>): one
 * card per platform with earned/total, percentage, the platinum/100% badge and trophies by tier,
 * plus "Todas" when the game is on more than one. Each card filters the list below to its
 * platform (the page's own `plataforma` filter), so the platform with the most progress is marked
 * and the combined view stays one click away.
 */
export function PlatformProgressStrip({
  game,
  current,
  hrefFor,
}: {
  game: PlayerGamePlatforms;
  /** The list's platform filter (undefined: all). */
  current: string | undefined;
  hrefFor: (platform: string | undefined) => string;
}) {
  const cards: Card[] = game.byPlatform.map((p) => ({
    id: p.platform,
    label: PLATFORM_LABEL[p.platform],
    color: PLATFORM_TOKEN[p.platform],
    unlocked: p.unlocked,
    total: p.total,
    pct: p.pct,
    badge: p.completed ? (p.platinumTrophy ? "Platina" : "100%") : null,
    trophies: p.trophies,
    href: hrefFor(p.platform),
    best: game.byPlatform.length > 1 && p.platform === game.best,
  }));
  if (game.byPlatform.length > 1) {
    cards.unshift({
      id: "todas",
      label: "Todas as plataformas",
      color: null,
      unlocked: game.combined.unlocked,
      total: game.combined.total,
      pct: game.combined.pct,
      badge: game.combined.completed ? "100%" : null,
      trophies: game.combined.trophies,
      href: hrefFor(undefined),
      best: false,
    });
  }
  const active = current ?? "todas";

  return (
    <section aria-labelledby="progresso-jogo" className="flex flex-col gap-3">
      <h2 id="progresso-jogo" className="text-[22px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
        Progresso em {game.name}
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-0">
        {cards.map((card) => {
          const on = card.id === active;
          return (
            <li key={card.id}>
              <Link
                href={card.href}
                scroll={false}
                aria-current={on ? "true" : undefined}
                style={card.color ? ({ "--c": card.color } as CSSProperties) : undefined}
                className={`flex h-full flex-col gap-2.5 rounded-[4px] border bg-surface p-4 hover:border-text ${on ? "border-text" : "border-line"}`}
              >
                <span className="flex items-center justify-between gap-2 font-mono text-xs tracking-[0.1em] uppercase">
                  <span className="flex items-center gap-2 text-text-2">
                    {card.color ? <span aria-hidden="true" className="size-[7px] bg-(--c)" /> : null}
                    {card.label}
                  </span>
                  {card.badge ? (
                    <span className="border border-(--gold) px-1.5 py-0.5 text-(--gold)">{card.badge}</span>
                  ) : card.best ? (
                    <span className="text-dim">Maior progresso</span>
                  ) : null}
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <b className="text-[26px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] tabular-nums">
                    {fmt(card.unlocked)}
                    <span className="text-acc">/</span>
                    {fmt(card.total)}
                  </b>
                  <b className="font-mono text-sm text-text tabular-nums">{card.pct}%</b>
                </span>
                <ProgressBar value={card.pct} label={`Conquistas de ${game.name}: ${card.label}`} />
                <span className="font-mono text-xs text-dim tabular-nums">
                  <span className="sr-only">Troféus: </span>
                  Platina {card.trophies.platinum}/{card.trophies.platinumOf} · Ouro {fmt(card.trophies.gold)} · Prata{" "}
                  {fmt(card.trophies.silver)} · Bronze {fmt(card.trophies.bronze)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
