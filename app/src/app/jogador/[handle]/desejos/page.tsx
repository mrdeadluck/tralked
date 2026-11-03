import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PLATFORM_LABEL } from "@/components/character/platforms";
import { GameCover } from "@/components/games/GameCover";
import { formatDate } from "@/components/profile/format";
import { PrivateProfile, SectionSkeleton } from "@/components/profile/PrivateProfile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { profilePath, ProfileTabs } from "@/components/profile/ProfileTabs";
import { Pagination } from "@/components/ui/Pagination";
import { getUserWishlist } from "@/lib/library/queries";
import { paginate, parsePagination, perPageParam } from "@/lib/pagination";
import { profileAccess, sectionMetadata } from "@/lib/profile/access";
import { getProfileSummary } from "@/lib/profile/queries";
import type { PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";

export async function generateStaticParams() {
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]/desejos">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  return sectionMetadata(header, "Lista de desejos", "/desejos", "Os jogos que este jogador quer, na ordem da lista de desejos da Steam.");
}

export default async function ProfileWishlistPage({ params, searchParams }: PageProps<"/jogador/[handle]/desejos">) {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SectionSkeleton label="Carregando lista de desejos" />}>
      <ProfileWishlist header={header} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileWishlist({
  header,
  searchParams,
}: {
  header: PlayerHeader;
  searchParams: PageProps<"/jogador/[handle]/desejos">["searchParams"];
}) {
  const { visible } = await profileAccess(header);
  if (!visible) return <PrivateProfile displayName={header.displayName} />;

  const params = await searchParams;
  const [summary, wishlist] = await Promise.all([getProfileSummary(header.id), getUserWishlist(header.id)]);
  if (!summary) notFound();
  const { page, perPage } = parsePagination(params);
  const list = paginate(wishlist, page, perPage);
  const kept = { por: perPageParam(perPage) };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <ProfileHeader summary={summary} section="Lista de desejos" />
        <ProfileTabs handle={header.handle} active="desejos" summary={summary} />
      </div>

      <p className="bg-surface px-3.5 py-3 tk-lbl text-text-2">
        {wishlist.length.toLocaleString("pt-BR")} {wishlist.length === 1 ? "jogo" : "jogos"} · lista de desejos da Steam
      </p>
      {list.items.length > 0 ? (
        <ol className="m-0 grid list-none gap-0.5 p-0">
          {list.items.map((item, index) => (
            <li
              key={item.gameId}
              className="grid grid-cols-[30px_90px_minmax(0,1fr)] items-center gap-3.5 bg-surface py-2 pr-3.5 pl-2 transition-colors duration-150 hover:bg-surface-2 min-[761px]:grid-cols-[40px_120px_minmax(0,1fr)_auto]"
            >
              <span className="text-center font-black font-stretch-[112%] text-muted tabular-nums">
                <span className="sr-only">Posição </span>
                {list.offset + index + 1}
              </span>
              <GameCover
                name={item.name}
                coverUrl={item.coverUrl}
                steamAppId={item.steamAppId}
                wideUrl={item.heroUrl}
                art={item.art}
                portraitChecked={!item.stub}
                ratio="16 / 9"
                alt=""
                className="rounded-none"
                width={120}
                sizes="120px"
              />
              <div className="min-w-0">
                <h3 className="text-[15px] leading-tight font-bold">
                  <Link href={`/jogos/${item.slug}`} className="hover:text-acc">
                    {item.name}
                  </Link>
                </h3>
                {item.addedAt ? (
                  <p className="mt-0.5 text-[12.5px] text-muted">Adicionado em {formatDate(item.addedAt)}</p>
                ) : null}
              </div>
              <span className="col-start-3 tk-lbl min-[761px]:col-start-auto">{PLATFORM_LABEL[item.platform]}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-6 text-muted">
          Lista de desejos vazia. Ela vem da Steam e aparece depois da sincronização com o perfil Steam público.
        </p>
      )}
      <Pagination
        basePath={profilePath(header.handle, "desejos")}
        params={kept}
        window={list}
        noun={["jogo", "jogos"]}
        label="Páginas da lista de desejos"
      />
    </div>
  );
}
