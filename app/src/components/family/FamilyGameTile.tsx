import { Chip } from "@/components/ui/Chip";
import { Placeholder } from "@/components/ui/Placeholder";
import { Ring } from "@/components/ui/Ring";
import type { FamilyLibraryEntry } from "@/lib/family/service";

/** Game tile shared by the joint library and "Quase lá da família" (same look as the home tiles). */
export function FamilyGameTile({ entry }: { entry: FamilyLibraryEntry }) {
  const { game, owners, bestProgress } = entry;
  return (
    <article className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-surface">
      {game.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote cover hosts are not whitelisted for next/image yet
        <img
          src={game.coverUrl}
          alt={`Capa de ${game.name}`}
          loading="lazy"
          className="aspect-[16/10] w-full object-cover"
        />
      ) : (
        <Placeholder label={`capa: ${game.name.toLowerCase()}`} />
      )}
      <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-4">
        <h3 className="text-[19px] leading-[1.15] font-extrabold font-stretch-[105%] tracking-[-0.015em]">
          {game.name}
        </h3>
        <ul className="flex flex-wrap gap-1.5" aria-label="Quem tem este jogo">
          {owners.map((owner) => (
            <li key={owner.handle}>
              <Chip plain>@{owner.handle}</Chip>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center justify-between gap-2.5 font-mono text-[11px] text-dim">
          <span>
            {bestProgress.unlocked === 0 ? (
              "Ninguém jogou ainda"
            ) : (
              <>
                <b className="text-text">@{bestProgress.handle}</b> lidera com{" "}
                <b className="text-text">{bestProgress.unlocked}</b> / {game.achievementCount}
              </>
            )}
          </span>
          <Ring value={bestProgress.pct} size={40} />
        </div>
      </div>
    </article>
  );
}
