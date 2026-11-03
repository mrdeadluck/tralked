import Link from "next/link";
import { GameHead } from "@/components/games/GameHead";
import type { GuideDetail } from "@/lib/queries/games";

/*
 * A walkthrough (format 2) whose stored data no longer passes the schema: the page says so instead
 * of falling back to the classic layout over a walkthrough's data (getGuidePublic logs the error).
 */
export function GuideUnavailable({ game }: { game: GuideDetail["game"] }) {
  return (
    <>
      <GameHead game={game} />
      <section className="mt-10 flex max-w-[640px] flex-col gap-3" aria-labelledby="g-indisponivel">
        <h2 id="g-indisponivel" className="text-[19px] leading-tight font-extrabold">
          Guia indisponível no momento
        </h2>
        <p className="text-text-2">
          Este guia está em correção e volta em breve. Enquanto isso, as conquistas e o seu progresso estão na{" "}
          <Link href={`/jogos/${game.slug}`} className="text-acc underline underline-offset-4 hover:no-underline">
            página de {game.name}
          </Link>
          .
        </p>
      </section>
    </>
  );
}
