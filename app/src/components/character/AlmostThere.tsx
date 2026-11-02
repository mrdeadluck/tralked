import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { Placeholder } from "@/components/ui/Placeholder";
import { Ring } from "@/components/ui/Ring";
import { SectionHead } from "@/components/ui/SectionHead";
import type { CharacterAlmostGame } from "@/lib/queries/players";

type AlmostThereProps = { games: CharacterAlmostGame[] };

/** "Quase lá": jogos com 70% ou mais das conquistas, ainda sem platina. */
export function AlmostThere({ games }: AlmostThereProps) {
  return (
    <section className="flex min-w-0 flex-col">
      <SectionHead
        title="Quase lá"
        aside={<Link href="/jogos">Ver jogos →</Link>}
      />
      {games.length === 0 ? (
        <p className="pt-5 text-sm text-muted">
          Nenhum jogo na reta final. Jogos com 70% ou mais das conquistas aparecem aqui.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pt-5">
          {games.map((game) => (
            <Link
              key={game.slug}
              href={`/jogos/${game.slug}`}
              className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-surface hover:border-line-2"
            >
              {game.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- capa externa (SteamGridDB/Steam)
                <img
                  src={game.coverUrl}
                  alt={`Capa de ${game.name}`}
                  className="aspect-[16/10] w-full object-cover"
                />
              ) : (
                <div className="[&>div]:rounded-none">
                  <Placeholder label={`capa: ${game.name.toLowerCase()}`} />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {game.skills.map((skill) => (
                    <Chip key={skill} plain>
                      {skill}
                    </Chip>
                  ))}
                  {game.hasGuide ? <Chip color="var(--acc)">Guia completo</Chip> : null}
                </div>
                <h3 className="text-[19px] leading-[1.15] font-extrabold font-stretch-[105%] tracking-[-0.015em]">
                  {game.name}
                </h3>
                <div className="mt-auto flex items-center justify-between gap-2.5 font-mono text-xs text-dim">
                  <span>
                    <b className="text-text">{game.unlocked}</b> / {game.total} conquistas
                  </span>
                  <Ring value={game.percent} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
