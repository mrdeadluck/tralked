import Link from "next/link";
import type { ReactNode } from "react";
import { UserText } from "@/components/community/UserText";
import { Chip } from "@/components/ui/Chip";
import type { CharacterPlatform } from "@/lib/character/sheet";
import type { Character } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import { formatNumber } from "./format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "./platforms";
import { XpBar } from "./XpBar";

type CharacterCardProps = {
  character: Character;
  /** Conexões ativas (verificadas ou não), na ordem Steam, PSN, Xbox, RetroAchievements. */
  platforms: CharacterPlatform[];
  /** Bio em texto puro escrita pelo jogador. */
  bio: string | null;
  /** Ações do dono do perfil (sincronizar, som). */
  actions?: ReactNode;
  /** Horas jogadas em todas as plataformas (minutos), mostradas ao lado do nível. */
  playtimeMin?: number;
  /** Dono do perfil: conexões não verificadas ganham o atalho "Verificar" (para /conta/conexoes). */
  isOwner?: boolean;
};

export function CharacterCard({ character, platforms, bio, actions, playtimeMin, isOwner = false }: CharacterCardProps) {
  const { stats } = character;
  const items: [string, string, string?][] = [
    [
      "Conquistas",
      formatNumber(stats.achievements),
      stats.pendingReview > 0 ? `+${formatNumber(stats.pendingReview)} em análise` : undefined,
    ],
    ["Jogos 100%", formatNumber(stats.perfectGames)],
    // Same rule and function as the Troféus card: a 100% per platform, or the PSN platinum trophy.
    ["Platinas", formatNumber(stats.platinums), "em todas as plataformas"],
    ["Lendárias", formatNumber(stats.legendary), "até 3% dos jogadores"],
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
        <span className="font-mono text-xs tracking-[0.14em] text-dim-2 uppercase">
          Personagem
        </span>
        <h1 className="mt-1.5 text-[clamp(30px,4vw,44px)] leading-none font-black font-stretch-[125%] tracking-[-0.035em] break-words uppercase">
          {character.displayName}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-xs tracking-[0.1em] uppercase">
          <span className="mr-1.5 text-acc">{character.vocation}</span>
          {platforms.length > 0 ? (
            <ul aria-label="Plataformas conectadas" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {platforms.map((p) => (
                <li
                  key={p.platform}
                  title={`${PLATFORM_LABEL[p.platform]}: ${p.handle}${p.verified ? " (conta verificada)" : ""}`}
                >
                  {/* Verified accounts earn a check; the others stay plain, without an alarm. */}
                  <Chip color={PLATFORM_TOKEN[p.platform]}>
                    {PLATFORM_LABEL[p.platform]}
                    <span className="sr-only">: {p.handle}</span>
                    {p.verified ? (
                      <>
                        <svg
                          viewBox="0 0 12 12"
                          aria-hidden="true"
                          className="ml-1 inline-block size-3 align-[-1px] text-acc"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M2.5 6.5 5 9l4.5-6" />
                        </svg>
                        <span className="sr-only"> (verificada)</span>
                      </>
                    ) : null}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <Chip>Nenhuma plataforma conectada</Chip>
          )}
          {isOwner && platforms.some((p) => !p.verified) ? (
            <Link
              href="/conta/conexoes"
              className="ml-1 inline-flex min-h-6 items-center text-text-3 normal-case tracking-normal underline decoration-line-2 underline-offset-[3px] hover:text-acc hover:decoration-current"
            >
              Verificar contas
            </Link>
          ) : null}
        </div>
        {bio ? <UserText text={bio} className="mt-3 max-w-[60ch] text-[15px] text-text-2" /> : null}
      </div>

      <div className="flex flex-wrap items-end gap-[18px] min-[641px]:col-span-2">
        <span className="text-[clamp(72px,10vw,112px)] leading-[0.8] font-black font-stretch-[125%] tracking-[-0.05em] text-acc tabular-nums">
          {character.level}
        </span>
        <span className="flex flex-col gap-1.5 pb-1">
          <b className="text-lg font-extrabold font-stretch-[112%]">Nível do personagem</b>
          <span className="font-mono text-xs text-dim" title={`${formatNumber(character.totalXp)} XP no total`}>
            {formatCompact(character.totalXp)} XP no total
          </span>
        </span>
        {playtimeMin !== undefined ? (
          <span className="ml-auto flex flex-col items-end gap-1 pb-1">
            <b className="text-[clamp(28px,3.6vw,40px)] leading-none font-black font-stretch-[112%] whitespace-nowrap tabular-nums">
              {`${formatNumber(Math.floor(playtimeMin / 60))} h`}
            </b>
            <span className="font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">Horas jogadas</span>
          </span>
        ) : null}
      </div>

      <div className="min-[641px]:col-span-2">
        <XpBar level={character.level} current={character.xpCurrent} next={character.xpNext} />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-line bg-line min-[641px]:col-span-2 min-[641px]:grid-cols-4">
        {items.map(([label, value, note]) => (
          <div key={label} className="bg-surface px-3.5 py-3">
            <dt className="font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-extrabold font-stretch-[112%] tabular-nums">
              {value}
              {note ? (
                <small className="mt-0.5 block font-mono text-xs font-normal tracking-normal text-dim">
                  {note}
                </small>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {actions ? <div className="min-[641px]:col-span-2">{actions}</div> : null}
    </article>
  );
}
