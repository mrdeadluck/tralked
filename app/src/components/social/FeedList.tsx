import Link from "next/link";
import { AuthorBadge } from "@/components/community/AuthorBadge";
import { PLATFORM_LABEL } from "@/components/character/platforms";
import type { PlatformId } from "@/lib/engine/trophies";
import type { FeedItem } from "@/lib/social/feed";
import { timeAgo } from "@/lib/time-ago";

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function Describe({ item }: { item: FeedItem }) {
  const game = (g: { slug: string; name: string }) => (
    <Link href={`/jogos/${g.slug}`} className="font-bold text-text hover:text-acc">
      {g.name}
    </Link>
  );
  switch (item.kind) {
    case "rare":
      return (
        <>
          desbloqueou <b className="text-text">{item.title}</b>, conquista rara ({pct(item.pct)} dos jogadores), em {game(item.game)}
        </>
      );
    case "perfect":
      return (
        <>
          completou {game(item.game)} em 100%
          {item.platform in PLATFORM_LABEL ? ` no ${PLATFORM_LABEL[item.platform as PlatformId]}` : ""}
        </>
      );
    case "hours":
      return (
        <>
          chegou a {item.hours.toLocaleString("pt-BR")} h em {game(item.game)}
        </>
      );
    case "article":
      return (
        <>
          publicou{" "}
          <Link href={`/noticias/${item.slug}`} className="font-bold text-text hover:text-acc">
            {item.title}
          </Link>
        </>
      );
    case "photo":
      return (
        <>
          enviou{" "}
          <Link href={`/galeria/${item.photoId}`} className="font-bold text-text hover:text-acc">
            {item.caption ? `a foto “${item.caption}”` : "uma foto"}
          </Link>
        </>
      );
  }
}

/** Activity of followed players, newest first. */
export function FeedList({ items, now, compact = false }: { items: FeedItem[]; now: Date; compact?: boolean }) {
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label="Atividade de quem você segue">
      {items.map((item) => (
        <li key={item.key} className={`flex flex-col gap-1.5 border-b border-divider last:border-b-0 ${compact ? "py-2.5" : "py-4"}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <AuthorBadge author={{ id: item.user.handle, ...item.user }} size={compact ? 22 : 28} />
            <time dateTime={item.at.toISOString()} className="font-mono text-[11px] text-dim">
              {timeAgo(item.at, now)}
            </time>
          </div>
          <p className={`${compact ? "text-[14px]" : "text-[15.5px]"} leading-snug text-text-2`}>
            <Describe item={item} />
          </p>
        </li>
      ))}
    </ol>
  );
}
