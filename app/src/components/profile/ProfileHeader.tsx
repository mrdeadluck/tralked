import Link from "next/link";
import type { ReactNode } from "react";
import { UserText } from "@/components/community/UserText";
import { formatNumber } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { XpBar } from "@/components/character/XpBar";
import { Chip } from "@/components/ui/Chip";
import { levelFromXp } from "@/lib/engine/xp";
import type { ProfileSummary } from "@/lib/profile/queries";
import { formatCompact } from "@/lib/xp-format";
import { ProfileBackdrop } from "./ProfileBackdrop";
import { profilePath } from "./ProfileTabs";

type ProfileHeaderProps = {
  summary: ProfileSummary;
  /** The tab shown under the header ("Ficha", "Jogos"…). */
  section: string;
  /** Rank among public profiles (the Ficha passes it; null: private profile). */
  rank?: number | null;
  /** XP of the last 7 days, under the total XP (the Ficha passes it). */
  week?: { total: number; community: number };
  /** Plain-text bio written by the player. */
  bio?: string | null;
  /** Owner: unverified connections get the "Verificar contas" shortcut. */
  isOwner?: boolean;
  /** Under the XP bar: the owner's sync and sound, or "Denunciar" for visitors. */
  actions?: ReactNode;
  /** More numbers after the shared three in the bottom strip (the Ficha's own). */
  stats?: ProfileStat[];
};

/** One number of the header's bottom strip. */
export type ProfileStat = { label: string; value: string; note?: string; title?: string; hot?: boolean };

// Columns from 761 px: one row up to four numbers, then rows of four.
const STRIP_COLS: Record<number, string> = {
  1: "min-[761px]:grid-cols-1",
  2: "min-[761px]:grid-cols-2",
  3: "min-[761px]:grid-cols-3",
  4: "min-[761px]:grid-cols-4",
};

/**
 * The strip under every profile tab's header: "Tralked" (the main counter: lists and games at 100%
 * on any platform), "Platinas" (the PSN platinum trophies, shown only with PSN) and "Jogos", then
 * the tab's own numbers.
 * Two columns on phones (a last odd one takes the row).
 */
function ProfileStrip({ summary, stats = [] }: { summary: ProfileSummary; stats?: ProfileStat[] }) {
  const psn = summary.psnPlatinums > 0 || summary.platforms.some((p) => p.platform === "psn");
  const items: ProfileStat[] = [
    { label: "Tralked", value: formatNumber(summary.tralked), note: "jogos 100% em qualquer plataforma", hot: true },
    ...(psn ? [{ label: "Platinas", value: formatNumber(summary.platinums), note: "troféus de platina da PSN" }] : []),
    { label: "Jogos", value: formatNumber(summary.gamesCount), note: "cada jogo uma vez" },
    ...stats,
  ];
  return (
    <dl
      role="group"
      aria-label="Números do perfil"
      className={`m-0 grid grid-cols-2 gap-0.5 border-t border-line max-[760px]:[&>div:last-child:nth-child(odd)]:col-span-2 ${STRIP_COLS[Math.min(4, items.length)]}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 bg-[color-mix(in_oklch,var(--bg)_55%,transparent)] px-3 py-2.5 min-[761px]:px-4 min-[761px]:py-3">
          <dt className="tk-lbl">{item.label}</dt>
          <dd
            className={`m-0 text-[22px] leading-[1.05] font-extrabold font-stretch-[110%] tabular-nums ${item.hot ? "text-acc" : ""}`}
            title={item.title}
          >
            {item.value}
          </dd>
          {item.note ? <dd className="m-0 text-[12.5px] text-muted">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * Identity header of every profile tab: the art of the last games played, taking turns (blurred,
 * desaturated, dimmed; ProfileBackdrop) behind the avatar with its lime level plate, name, vocation and platforms, and the level
 * box with the XP to the next level (the "Nível"), over the numbers strip (ProfileStrip). The Ficha
 * adds the rank, the week's XP and its own numbers to the strip.
 */
export function ProfileHeader({ summary, section, rank, week, bio, isOwner = false, actions, stats }: ProfileHeaderProps) {
  const progress = levelFromXp(summary.totalXp);
  const unverified = isOwner && summary.platforms.some((p) => !p.verified);
  return (
    <header className="relative isolate">
      {/* The frame and the art live on their own clipped layer: overlays opened from the actions stay whole. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden bg-surface tk-cut">
        <ProfileBackdrop urls={summary.backdropUrls} />
        <span className="absolute inset-0 bg-[linear-gradient(90deg,var(--surface)_8%,color-mix(in_oklch,var(--surface)_70%,transparent)_55%,color-mix(in_oklch,var(--surface)_85%,transparent)),linear-gradient(0deg,var(--surface),transparent_60%)]" />
      </div>

      <div className="grid items-center gap-x-7 gap-y-5 p-[18px] min-[761px]:grid-cols-[auto_minmax(0,1fr)] min-[761px]:p-[26px] min-[1101px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,420px)]">
        <div className="relative size-[96px] flex-none min-[761px]:size-[116px]">
          <div
            aria-hidden="true"
            className="grid size-full place-items-center overflow-hidden bg-[linear-gradient(160deg,var(--hover-2),var(--surface))] text-[40px] leading-none font-black font-stretch-[125%] text-text shadow-[inset_0_0_0_2px_var(--border-2)]"
          >
            {summary.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar from the platform, external host
              <img src={summary.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              summary.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <span className="absolute -right-2.5 -bottom-2.5 grid h-[34px] min-w-[52px] place-items-center bg-acc px-2 text-lg font-black font-stretch-[112%] text-acc-ink tabular-nums tk-cut-x">
            <span className="sr-only">Nível </span>
            {summary.level}
          </span>
        </div>

        <div className="min-w-0">
          <span className="tk-lbl">{section === "Ficha" ? "Ficha de personagem" : section}</span>
          <h1 className="mt-0.5 text-[clamp(28px,4vw,44px)] leading-none font-black font-stretch-[118%] tracking-[-0.03em] break-words">
            <Link href={profilePath(summary.handle)} className="hover:text-acc">
              {summary.displayName}
            </Link>
          </h1>
          <p className="mt-2 mb-3 text-[15px] text-text-2">
            @{summary.handle} · <b className="font-bold text-acc">{summary.vocation}</b>
            {rank ? <> · #{formatNumber(rank)} no ranking geral</> : null}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {summary.platforms.length > 0 ? (
              <ul aria-label="Plataformas conectadas" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {summary.platforms.map((p) => (
                  <li
                    key={p.platform}
                    title={`${PLATFORM_LABEL[p.platform]}: ${p.handle}${p.verified ? " (conta verificada)" : ""}`}
                  >
                    <Chip color={PLATFORM_TOKEN[p.platform]}>
                      {PLATFORM_LABEL[p.platform]}
                      <span className="sr-only">: {p.handle}</span>
                      {p.verified ? (
                        <>
                          <svg
                            viewBox="0 0 12 12"
                            aria-hidden="true"
                            className="size-[11px] text-acc"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
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
              <Chip plain>Nenhuma plataforma conectada</Chip>
            )}
            {unverified ? (
              <Link
                href="/conta/conexoes"
                className="ml-1 inline-flex min-h-6 items-center text-[13px] text-text-2 underline decoration-line-2 underline-offset-[3px] hover:text-acc hover:decoration-current"
              >
                Verificar contas
              </Link>
            ) : null}
          </div>
          {bio ? <UserText text={bio} className="mt-3 max-w-[60ch] text-[15px] text-text-2" /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2.5 bg-[color-mix(in_oklch,var(--bg)_75%,transparent)] p-4 shadow-[inset_0_0_0_1px_var(--border)] min-[761px]:col-span-2 min-[1101px]:col-span-1">
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="tk-lbl">Nível</span>
              <div className="text-[54px] leading-[0.85] font-black font-stretch-[125%] tracking-[-0.04em] tabular-nums">
                {summary.level}
              </div>
            </div>
            <div className="text-right text-[13.5px] text-text-2">
              <b
                className="block text-[17px] font-extrabold text-text tabular-nums"
                title={`${formatNumber(summary.totalXp)} XP no total`}
              >
                {formatCompact(summary.totalXp)} XP
              </b>
              {week ? (
                <span title={`${formatNumber(week.total)} XP nos últimos 7 dias`}>
                  {formatCompact(week.total)} nesta semana
                </span>
              ) : (
                "no total"
              )}
            </div>
          </div>
          <XpBar level={summary.level} current={progress.current} next={progress.next} />
          {actions ? <div className="mt-1 border-t border-line pt-3">{actions}</div> : null}
        </div>
      </div>

      <ProfileStrip summary={summary} stats={stats} />
    </header>
  );
}
