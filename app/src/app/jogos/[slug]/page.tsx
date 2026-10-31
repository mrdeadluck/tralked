import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FactsStrip } from "@/components/games/FactsStrip";
import { GameHead } from "@/components/games/GameHead";
import { LinkButton } from "@/components/games/LinkButton";
import { getSessionUser } from "@/lib/auth/session";
import { getGame, getGuide } from "@/lib/queries/games";
import { gameMetadata } from "./metadata";

export async function generateMetadata({ params }: PageProps<"/jogos/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return gameMetadata(slug);
}

export default function GamePage({ params }: PageProps<"/jogos/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <GameContent params={params} />
    </Suspense>
  );
}

const linkClass = "text-acc underline underline-offset-2";

async function GameContent({ params }: Pick<PageProps<"/jogos/[slug]">, "params">) {
  const { slug } = await params;
  // Relative dates ("há 3 dias") need the request time; opt this subtree into request-time rendering.
  await connection();
  const user = await getSessionUser();
  const now = new Date();

  const guide = await getGuide(slug, user?.id);
  const game = guide?.game ?? (await getGame(slug, user?.id));
  if (!game) notFound();

  return (
    <>
      <GameHead game={game} now={now} />

      {guide ? (
        <>
          <FactsStrip facts={guide.facts} totalXp={guide.totals.xp} />
          <div className="mt-10 flex flex-col items-start gap-3.5 rounded-[4px] border border-line bg-surface p-[22px]">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">
              Guia completo
            </span>
            <h2 className="text-[26px] leading-none font-black font-stretch-[115%] tracking-[-0.03em]">
              Conquistas de {game.name} do começo ao 100%
            </h2>
            <p className="max-w-[52ch] text-muted">
              {guide.steps.length} etapas, {guide.achievements.length} conquistas explicadas, coletáveis
              e dicas da comunidade.
            </p>
            <LinkButton href={`/jogos/${game.slug}/guia`} variant="primary">
              Abrir o guia 100%
            </LinkButton>
          </div>
        </>
      ) : (
        <div className="mt-10 flex flex-col items-center gap-3.5 rounded-[4px] border border-dashed border-line-2 px-6 py-10 text-center">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">
            Guia em produção
          </span>
          <h2 className="text-[26px] leading-none font-black font-stretch-[115%] tracking-[-0.03em]">
            A comunidade está escrevendo este guia
          </h2>
          <p className="max-w-[52ch] text-muted">
            Guias completos nascem de rascunhos revisados pela comunidade. Quem escreve ou revisa
            trechos aprovados ganha XP na skill Sábio.
          </p>
          <Link href="/jogos/hollow-knight/guia" className={`${linkClass} font-mono text-xs tracking-[0.08em] uppercase`}>
            Ver um guia completo de exemplo
          </Link>
        </div>
      )}

      {game.summary ? (
        <p className="mt-10 max-w-[72ch] text-[17px] leading-[1.6] text-text-2">{game.summary}</p>
      ) : null}

      <p className="mt-10 font-mono text-[11px] tracking-[0.04em] text-dim-2">
        Dados de jogos:{" "}
        <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer" className="hover:text-acc">
          IGDB
        </a>
        ,{" "}
        <a href="https://rawg.io" target="_blank" rel="noopener noreferrer" className="hover:text-acc">
          RAWG
        </a>{" "}
        · Arte:{" "}
        <a
          href="https://www.steamgriddb.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-acc"
        >
          SteamGridDB
        </a>
      </p>
    </>
  );
}
