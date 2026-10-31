import type { ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import type { Character } from "@/lib/queries/players";
import { formatNumber } from "./format";
import { XpBar } from "./XpBar";

type CharacterCardProps = {
  character: Character;
  /** Ações do dono do perfil (sincronizar, som). */
  actions?: ReactNode;
};

export function CharacterCard({ character, actions }: CharacterCardProps) {
  const { stats } = character;
  const items: [string, string][] = [
    ["Conquistas", formatNumber(stats.achievements)],
    ["Jogos 100%", formatNumber(stats.perfectGames)],
    ["Lendárias", formatNumber(stats.legendary)],
    ["Ranking geral", stats.rank === null ? "—" : `#${formatNumber(stats.rank)}`],
  ];

  return (
    <article className="grid items-center gap-6 rounded-[4px] border border-line bg-surface p-5 min-[641px]:grid-cols-[auto_1fr] min-[641px]:p-7">
      <div
        aria-hidden="true"
        className="grid size-[104px] place-items-center overflow-hidden rounded-full border-[3px] border-acc bg-[repeating-linear-gradient(135deg,#1a1c22_0_7px,#22242b_7px_14px)] text-[40px] leading-none font-black font-stretch-[125%] text-acc"
      >
        {character.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar da Steam, domínio externo
          <img src={character.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          character.displayName.charAt(0).toUpperCase()
        )}
      </div>

      <div>
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">
          Personagem
        </span>
        <h1 className="mt-1.5 text-[clamp(30px,4vw,44px)] leading-none font-black font-stretch-[125%] tracking-[-0.035em] break-words uppercase">
          {character.displayName}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] tracking-[0.1em] uppercase">
          <span className="mr-1.5 text-acc">{character.vocation}</span>
          <Chip color="var(--pc)">Steam vinculada</Chip>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-[18px] min-[641px]:col-span-2">
        <span className="text-[clamp(72px,10vw,112px)] leading-[0.8] font-black font-stretch-[125%] tracking-[-0.05em] text-acc tabular-nums">
          {character.level}
        </span>
        <span className="flex flex-col gap-1.5 pb-1">
          <b className="text-lg font-extrabold font-stretch-[112%]">Nível do personagem</b>
          <span className="font-mono text-xs text-dim">
            {formatNumber(character.totalXp)} XP total
          </span>
        </span>
      </div>

      <div className="min-[641px]:col-span-2">
        <XpBar level={character.level} current={character.xpCurrent} next={character.xpNext} />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-line bg-line min-[641px]:col-span-2 min-[641px]:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="bg-surface px-3.5 py-3">
            <dt className="font-mono text-[10px] tracking-[0.12em] text-dim-2 uppercase">
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-extrabold font-stretch-[112%] tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {actions ? <div className="min-[641px]:col-span-2">{actions}</div> : null}
    </article>
  );
}
