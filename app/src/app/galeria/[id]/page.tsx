import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthorBadge } from "@/components/community/AuthorBadge";
import { Comments } from "@/components/community/Comments";
import { Trail } from "@/components/community/PageHead";
import { PhotoGrid } from "@/components/community/PhotoGrid";
import { PhotoMedia } from "@/components/community/PhotoMedia";
import { ReactionButtons } from "@/components/community/ReactionButtons";
import { ReportButton } from "@/components/community/ReportButton";
import { PhotoModBar } from "@/components/moderation/PhotoModBar";
import { UserText } from "@/components/community/UserText";
import { getPhotoCached, listPhotosCached } from "@/lib/community/cached";
import { formatWhen } from "@/lib/community/format";
import { recentPhotoIds, type PhotoDetail } from "@/lib/community/gallery";
import { myReactions, reactionXpOpen, type MyReaction } from "@/lib/community/reactions";
import { REACTION_GIVEN_XP } from "@/lib/community/rewards";
import { currentViewer } from "@/lib/community/viewer";
import { prisma } from "@/lib/db";
import { SITE_OPEN_GRAPH } from "@/lib/seo/metadata";

export async function generateStaticParams() {
  const ids = await recentPhotoIds(12);
  // Cache Components needs at least one sample; unknown ids render on demand.
  return (ids.length > 0 ? ids : ["exemplo"]).map((id) => ({ id }));
}

function titleOf(photo: PhotoDetail) {
  const who = photo.author ? `@${photo.author.handle}` : "Conta removida";
  return photo.game ? `${photo.game.name} por ${who}` : `Foto de ${who}`;
}

export async function generateMetadata({ params }: PageProps<"/galeria/[id]">): Promise<Metadata> {
  const { id } = await params;
  const photo = await getPhotoCached(id);
  if (!photo) return { title: "Foto não encontrada | Tralked" };
  return {
    title: `${titleOf(photo)} | Galeria Tralked`,
    description: photo.caption ?? `Captura de ${photo.game?.name ?? "jogo"} na galeria da comunidade Tralked.`,
    alternates: { canonical: `/galeria/${id}` },
    openGraph: photo.url
      ? { ...SITE_OPEN_GRAPH, url: `/galeria/${id}`, images: [{ url: photo.url, width: photo.width, height: photo.height }] }
      : undefined,
  };
}

export default async function PhotoPage({ params }: PageProps<"/galeria/[id]">) {
  const { id } = await params;
  const photo = await getPhotoCached(id);
  if (!photo) notFound();
  const returnTo = `/galeria/${photo.id}`;
  const alt = photo.caption
    ? `${photo.game ? `${photo.game.name}: ` : ""}${photo.caption}`
    : `Captura de ${photo.game?.name ?? "jogo"} enviada por ${photo.author ? `@${photo.author.handle}` : "conta removida"}`;

  return (
    <div className="flex flex-col gap-10">
      <article className="flex flex-col gap-5">
        <Trail>
          <Link href="/galeria" className="hover:text-acc">
            Galeria
          </Link>
          {photo.game ? (
            <>
              {" / "}
              <Link href={`/galeria?jogo=${encodeURIComponent(photo.game.slug)}`} className="hover:text-acc">
                {photo.game.name}
              </Link>
            </>
          ) : null}
        </Trail>
        <h1 className="sr-only">{titleOf(photo)}</h1>

        <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)] gap-0 overflow-hidden rounded-[4px] border border-line bg-surface max-[900px]:grid-cols-1">
          <figure className="m-0 flex items-center justify-center bg-bg-deep">
            <div className="w-full" style={{ aspectRatio: `${photo.width} / ${photo.height}`, maxHeight: "82vh" }}>
              <PhotoMedia
                id={photo.id}
                url={photo.url}
                width={photo.width}
                height={photo.height}
                gameSlug={photo.game?.slug}
                alt={alt}
                fit="contain"
                eager
              />
            </div>
          </figure>

          <div className="flex min-w-0 flex-col gap-5 border-l border-line p-6 max-[900px]:border-t max-[900px]:border-l-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AuthorBadge author={photo.author} size={36} />
              <time dateTime={new Date(photo.createdAt).toISOString()} className="font-mono text-xs text-dim">
                {formatWhen(photo.createdAt)}
              </time>
            </div>
            {photo.caption ? <UserText text={photo.caption} className="text-[17px] leading-relaxed text-text" /> : null}
            {photo.game ? (
              <p className="font-mono text-xs tracking-[0.06em] text-dim uppercase">
                Jogo:{" "}
                <Link href={`/jogos/${photo.game.slug}`} className="text-text-2 normal-case underline decoration-line-2 underline-offset-2 hover:text-acc">
                  {photo.game.name}
                </Link>
                {photo.author ? (
                  <span className="normal-case">
                    {" · "}
                    {photo.authorPhotoCount} {photo.authorPhotoCount === 1 ? "foto" : "fotos"} de @{photo.author.handle}
                  </span>
                ) : null}
              </p>
            ) : null}

            <Suspense fallback={<PhotoActions photo={photo} mine={0} loggedIn={false} returnTo={returnTo} pending />}>
              <PhotoActionsIsland photo={photo} returnTo={returnTo} />
            </Suspense>

            <div className="border-t border-line pt-5">
              <Comments targetType="photo" targetId={photo.id} compact />
            </div>
          </div>
        </div>
      </article>

      {photo.game ? (
        <Suspense fallback={null}>
          <MoreFromGame gameSlug={photo.game.slug} gameName={photo.game.name} exceptId={photo.id} />
        </Suspense>
      ) : null}
    </div>
  );
}

type ActionsProps = {
  photo: PhotoDetail;
  mine: MyReaction;
  loggedIn: boolean;
  returnTo: string;
  pending?: boolean;
  /** Moderators get "Ocultar" and "Remover" (checked again on the server). */
  moderator?: boolean;
  /** XP the viewer's first reaction would pay (see ReactionButtons). */
  xpHint?: number;
};

function PhotoActions({ photo, mine, loggedIn, returnTo, pending, moderator = false, xpHint }: ActionsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ReactionButtons
          targetType="photo"
          targetId={photo.id}
          likes={photo.likeCount}
          dislikes={photo.dislikeCount}
          mine={mine}
          loggedIn={loggedIn}
          returnTo={returnTo}
          what="esta foto"
          pending={pending}
          xpHint={xpHint}
        />
        <ReportButton
          targetType="photo"
          targetId={photo.id}
          loggedIn={loggedIn}
          returnTo={returnTo}
          what="esta foto"
          pending={pending}
        />
      </div>
      {moderator ? <PhotoModBar photoId={photo.id} /> : null}
    </div>
  );
}

async function PhotoActionsIsland({ photo, returnTo }: { photo: PhotoDetail; returnTo: string }) {
  const viewer = await currentViewer();
  const [mine, xpOpen] = viewer
    ? await Promise.all([
        myReactions(prisma, viewer.id, "photo", [photo.id]).then((m) => m[photo.id]),
        reactionXpOpen(prisma, viewer.id, "photo", [photo.id]),
      ])
    : [undefined, [] as string[]];
  // Reacting to your own photo pays nothing.
  const own = viewer !== null && photo.author?.id === viewer.id;
  return (
    <PhotoActions
      photo={photo}
      mine={mine ?? 0}
      loggedIn={viewer !== null}
      returnTo={returnTo}
      moderator={viewer?.moderator}
      xpHint={!own && xpOpen.length > 0 ? REACTION_GIVEN_XP : undefined}
    />
  );
}

async function MoreFromGame({ gameSlug, gameName, exceptId }: { gameSlug: string; gameName: string; exceptId: string }) {
  const listing = await listPhotosCached(gameSlug, 1);
  const photos = listing.photos.filter((p) => p.id !== exceptId).slice(0, 6);
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="mais-fotos" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-text pb-4">
        <h2 id="mais-fotos" className="text-[26px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
          Mais de {gameName}
        </h2>
        <Link
          href={`/galeria?jogo=${encodeURIComponent(gameSlug)}`}
          className="font-mono text-xs tracking-[0.08em] text-acc uppercase hover:underline"
        >
          Ver todas →
        </Link>
      </div>
      <PhotoGrid photos={photos} label={`Mais fotos de ${gameName}`} empty="" />
    </section>
  );
}
