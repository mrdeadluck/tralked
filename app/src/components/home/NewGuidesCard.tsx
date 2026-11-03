import Link from "next/link";
import { GameCover } from "@/components/games/GameCover";
import { Chip } from "@/components/ui/Chip";
import { SectionHead } from "@/components/ui/SectionHead";
import type { HomeGuideSeal, HomeGuideView } from "@/lib/queries/home-guides";
import { timeAgo } from "@/lib/time-ago";

/** A guide keeps the "Novo" badge for its first week. */
const NEW_MS = 7 * 86_400_000;

const SEALS: Record<HomeGuideSeal, { label: string; color: string }> = {
  steam: { label: "Steam", color: "var(--pc)" },
  psn: { label: "PSN", color: "var(--ps)" },
  xbox: { label: "Xbox", color: "var(--xbox)" },
};

/** One guide: vertical cover, name (and "Novo"), what it covers, its seals and when it came out. */
function GuideRow({ guide, now }: { guide: HomeGuideView; now: Date }) {
  const fresh = now.getTime() - guide.publishedAt.getTime() < NEW_MS;
  return (
    <Link href={guide.href} className="group flex items-center gap-3.5 rounded-[3px] py-2.5 pr-2 hover:bg-hover focus-visible:bg-hover">
      <span className="w-[54px] shrink-0 overflow-hidden tk-cut-sm">
        <GameCover
          name={guide.name}
          coverUrl={guide.coverUrl}
          steamAppId={guide.steamAppId}
          wideUrl={guide.heroUrl}
          portraitChecked={guide.portraitChecked}
          ratio="3 / 4"
          alt=""
          width={54}
          sizes="54px"
          className="rounded-[2px]"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] leading-tight font-bold group-hover:text-acc">{guide.name}</span>
          {fresh ? (
            <span className="shrink-0 bg-acc px-1.5 py-px font-mono text-xs font-bold tracking-[0.1em] text-acc-ink uppercase tk-cut-sm">
              Novo
            </span>
          ) : null}
        </span>
        <span className="font-mono text-xs leading-snug text-text-2">{guide.line}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {guide.seals.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {guide.seals.map((seal) => (
                <Chip key={seal} color={SEALS[seal].color}>
                  {SEALS[seal].label}
                </Chip>
              ))}
            </span>
          ) : null}
          <time dateTime={guide.publishedAt.toISOString()} className="font-mono text-xs text-dim">
            {timeAgo(guide.publishedAt, now)}
          </time>
        </span>
      </span>
    </Link>
  );
}

/**
 * Home card "Novos guias", above "Lançamentos": the newest published walkthroughs, then 100%
 * guides, with a link to every game with a guide. Nothing at all while no guide is published.
 */
export function NewGuidesCard({ guides, now }: { guides: HomeGuideView[]; now: Date }) {
  if (guides.length === 0) return null;
  return (
    <section aria-label="Novos guias" className="flex flex-col gap-4">
      <SectionHead title="Novos guias" />
      <ul className="m-0 flex list-none flex-col p-0">
        {guides.map((guide) => (
          <li key={guide.id} className="border-b border-divider">
            <GuideRow guide={guide} now={now} />
          </li>
        ))}
      </ul>
      <Link
        href="/jogos?guia=1"
        className="self-start font-mono text-xs tracking-[0.08em] text-acc uppercase hover:underline hover:underline-offset-4"
      >
        Todos os guias →
      </Link>
    </section>
  );
}
