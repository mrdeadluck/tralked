import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { PageHead } from "@/components/community/PageHead";
import { Pager, pageParam } from "@/components/community/Pager";
import { PhotoGrid } from "@/components/community/PhotoGrid";
import { PhotoMedia } from "@/components/community/PhotoMedia";
import { SideCard } from "@/components/community/SideCard";
import { UploadPhoto } from "@/components/community/UploadPhoto";
import { CommentIcon, HeartIcon } from "@/components/community/icons";
import {
  CommunityShowcase,
  CommunityShowcaseSkeleton,
  SHOWCASE_PRIMARY,
} from "@/components/community/CommunityShowcase";
import { galleryRedirectHref } from "@/lib/catalog/redirects";
import { showcaseShotsCached } from "@/lib/community/showcase";
import { galleryGameCached, galleryGamesCached, listPhotosCached, photoOfTheWeekCached } from "@/lib/community/cached";
import type { GameOption, PhotoCardView } from "@/lib/community/gallery";
import { currentViewer } from "@/lib/community/viewer";
import { PHOTO_XP, PHOTO_XP_DAILY_CAP } from "@/lib/community/xp";

export const metadata: Metadata = {
  title: "Galeria da comunidade | Tralked",
  description: "Capturas de jogos enviadas pela comunidade Tralked: curta, comente e mostre as suas.",
};

type SearchParams = PageProps<"/galeria">["searchParams"];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** The `?jogo=` game: from the filter list, else looked up alone (a game with no photos yet). */
async function requestedGallery(withPhotos: GameOption[], slug: string | null): Promise<GameOption | null> {
  if (!slug || slug.length > 120) return null;
  return withPhotos.find((g) => g.slug === slug) ?? (await galleryGameCached(slug));
}

function galleryHref(game: string | null, page = 1) {
  const params = new URLSearchParams();
  if (game) params.set("jogo", game);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return query ? `/galeria?${query}` : "/galeria";
}

export default async function GalleryPage({ searchParams }: PageProps<"/galeria">) {
  // Cached (part of the static shell): is there anything to show at all? The loading state takes
  // the shape of what will land, the photo grid or the empty gallery's invitation, so nothing jumps.
  const anyPhoto = (await listPhotosCached(null, 1)).photos.length > 0;
  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title="Galeria"
        lede="Capturas dos jogos que a comunidade está jogando agora. A foto mais curtida da semana ganha destaque."
      />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-7 max-[1000px]:grid-cols-1">
        <Suspense fallback={anyPhoto ? <GridSkeleton /> : <CommunityShowcaseSkeleton />}>
          <GalleryContent searchParams={searchParams} />
        </Suspense>
        <aside className="flex flex-col gap-4" aria-label="Enviar e regras da galeria">
          <SideCard title="Poste sua foto" id="enviar-foto">
            <p className="text-[14px] text-muted">
              Suas capturas aparecem aqui e no seu perfil. Cada foto rende {PHOTO_XP} XP, até {PHOTO_XP_DAILY_CAP} fotos
              por dia.
            </p>
            <Suspense fallback={<UploadPhoto loggedIn={false} returnTo="/galeria" pending />}>
              <UploadIsland searchParams={searchParams} />
            </Suspense>
          </SideCard>
          <SideCard title="Combinados">
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[14px] text-muted">
              <li>Só capturas de jogos, marcadas com o jogo certo.</li>
              <li>Spoiler grande? Avise na legenda.</li>
              <li>Viu algo fora do lugar? Use “Denunciar” na foto.</li>
            </ul>
          </SideCard>
        </aside>
      </div>
    </div>
  );
}

async function GalleryContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedGame = first(params.jogo);
  // Only games with listed photos (the filter), not the whole catalog.
  const withPhotos = await galleryGamesCached();
  const game = await requestedGallery(withPhotos, requestedGame);
  if (requestedGame && !game) {
    // Not a game any more: the slug of one merged into another goes to the kept game's gallery.
    const kept = await galleryRedirectHref(params);
    if (kept) permanentRedirect(kept);
  }
  const listing = await listPhotosCached(game?.slug ?? null, pageParam(params.pagina));
  const featured = !game && listing.page === 1 ? await photoOfTheWeekCached() : null;

  // Nobody has posted yet: an invitation over the games people play, not a dashed box.
  if (!game && listing.page === 1 && listing.photos.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <CommunityShowcase
          id="galeria-vazia"
          title="Seja a primeira foto da galeria"
          text="Uma captura sua, marcada com o jogo, abre a galeria do Tralked e aparece no seu perfil. Vale o chefe que custou a cair, a paisagem, a platina na tela."
          xp={`+${PHOTO_XP} XP`}
          xpNote={`por foto, até ${PHOTO_XP_DAILY_CAP} por dia`}
          shots={await showcaseShotsCached(3)}
          shotHref={(slug) => galleryHref(slug)}
          actions={
            // On wide screens the upload card sits right beside it: the button is for phones.
            <a href="#enviar-foto" className={`${SHOWCASE_PRIMARY} min-[1001px]:hidden`}>
              Enviar a primeira foto
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {featured ? <PhotoOfTheWeek photo={featured} /> : null}

      {/* Only when there is something to filter: a lone "Todos" chip filters nothing. */}
      {withPhotos.length > 0 ? (
        <nav aria-label="Filtrar por jogo" className="flex flex-wrap gap-1.5">
          <FilterLink href={galleryHref(null)} current={!game} label="Todos" />
          {withPhotos.map((g) => (
            <FilterLink key={g.slug} href={galleryHref(g.slug)} current={game?.slug === g.slug} label={g.name} count={g.photoCount} />
          ))}
        </nav>
      ) : null}

      <PhotoGrid
        photos={listing.photos}
        label={game ? `Fotos de ${game.name}` : "Fotos da comunidade"}
        empty={game ? `Ainda não há fotos de ${game.name}. Que tal enviar a primeira?` : "Ainda não há fotos. Envie a primeira!"}
      />
      <Pager
        page={listing.page}
        pageCount={listing.pageCount}
        href={(page) => galleryHref(game?.slug ?? null, page)}
        label="Páginas da galeria"
      />
    </div>
  );
}

function FilterLink({ href, current, label, count }: { href: string; current: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex h-[34px] items-center gap-2 rounded-[2px] border px-3 font-mono text-xs tracking-[0.08em] uppercase ${
        current ? "border-text bg-text text-bg" : "border-line-2 text-text-3 hover:border-dim hover:text-text"
      }`}
    >
      {label}
      {count !== undefined ? <span className={current ? "text-bg/70" : "text-dim"}>{count}</span> : null}
    </Link>
  );
}

function PhotoOfTheWeek({ photo }: { photo: PhotoCardView }) {
  return (
    <section aria-labelledby="foto-da-semana" className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-0 overflow-hidden rounded-[4px] border border-line bg-surface max-[700px]:grid-cols-1">
      <Link href={`/galeria/${photo.id}`} className="group relative block aspect-[16/10] overflow-hidden focus-visible:outline-offset-[-2px]" aria-label="Abrir a foto da semana">
        <span className="block size-full transition-transform duration-700 ease-out group-hover:scale-[1.03]">
          <PhotoMedia id={photo.id} url={photo.url} width={photo.width} height={photo.height} gameSlug={photo.game?.slug} alt="" eager />
        </span>
        <span className="absolute top-3 left-3 bg-acc px-2 py-1 font-mono text-xs font-bold tracking-[0.12em] text-bg uppercase">
          Foto da semana
        </span>
      </Link>
      <div className="flex flex-col justify-between gap-6 p-6">
        <div className="flex flex-col gap-3">
          <h2 id="foto-da-semana" className="text-[26px] leading-[1.05] font-black font-stretch-[112%] tracking-[-0.02em]">
            {photo.caption ?? "Sem legenda"}
          </h2>
          <p className="font-mono text-[12px] text-dim">
            {photo.author ? `@${photo.author.handle}` : "Conta removida"}
            {photo.game ? ` · ${photo.game.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-5 font-mono text-[13px] font-bold">
          <span className="inline-flex items-center gap-1.5 text-acc">
            <HeartIcon filled /> {photo.likeCount} <span className="sr-only">curtidas</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-2">
            <CommentIcon /> {photo.commentCount} <span className="sr-only">comentários</span>
          </span>
        </div>
      </div>
    </section>
  );
}

async function UploadIsland({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, games, params] = await Promise.all([currentViewer(), galleryGamesCached(), searchParams]);
  const requested = first(params.jogo);
  const returnTo = galleryHref(requested);
  // Filtered by a game: the form starts with it. Only that one game crosses to the client.
  const filtered = await requestedGallery(games, requested);
  return (
    <UploadPhoto
      loggedIn={viewer !== null}
      returnTo={returnTo}
      defaultGame={filtered ? { slug: filtered.slug, name: filtered.name } : null}
    />
  );
}

/**
 * Same blocks as the content (photo of the week, filter row, photo grid), so nothing below jumps
 * when the photos stream in (the side card sits under the grid on phones).
 */
function GridSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando fotos" className="flex min-w-0 flex-col gap-6">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] overflow-hidden rounded-[4px] border border-line bg-surface max-[700px]:grid-cols-1">
        <div className="aspect-[16/10] animate-pulse bg-surface-2 motion-reduce:animate-none" />
        <div className="h-[178px] max-[700px]:block" />
      </div>
      <div className="h-[34px]" />
      <div className="grid grid-cols-3 gap-1 max-[420px]:grid-cols-2">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="aspect-square animate-pulse bg-surface motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
