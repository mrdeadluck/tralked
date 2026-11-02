import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
    <div className="flex flex-col gap-6">
      <ProfileHeader summary={summary} section="Lista de desejos" />
      <ProfileTabs handle={header.handle} active="desejos" />

      <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
        {wishlist.length.toLocaleString("pt-BR")} {wishlist.length === 1 ? "jogo" : "jogos"} · lista de desejos da Steam
      </p>
      {list.items.length > 0 ? (
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-0">
          {list.items.map((item, index) => (
            <li key={item.gameId} className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-surface">
              <div className="relative [&>*]:rounded-none">
                <GameCover
                  name={item.name}
                  coverUrl={item.coverUrl}
                  steamAppId={item.steamAppId}
                  wideUrl={item.heroUrl}
                  art={item.art}
                  portraitChecked={!item.stub}
                  alt=""
                  width={360}
                  sizes="(max-width: 520px) calc(100vw - 40px), 360px"
                />
                <span className="absolute top-2 left-2 bg-bg px-1.5 py-0.5 font-mono text-xs font-bold text-text">
                  #{list.offset + index + 1}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 px-4 pt-3 pb-4">
                <h3 className="text-[17px] leading-tight font-extrabold font-stretch-[105%]">
                  <Link href={`/jogos/${item.slug}`} className="hover:text-acc">
                    {item.name}
                  </Link>
                </h3>
                {item.addedAt ? (
                  <p className="mt-auto font-mono text-xs text-dim">Adicionado em {formatDate(item.addedAt)}</p>
                ) : null}
              </div>
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
