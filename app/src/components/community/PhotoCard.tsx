import Link from "next/link";
import type { PhotoCardView } from "@/lib/community/gallery";
import { CommentIcon, HeartIcon } from "./icons";
import { PhotoMedia } from "./PhotoMedia";

export function photoLabel(photo: PhotoCardView): string {
  const who = photo.author ? `@${photo.author.handle}` : "conta removida";
  const game = photo.game ? ` em ${photo.game.name}` : "";
  return `Foto de ${who}${game}${photo.caption ? `: ${photo.caption}` : ""}`;
}

/** Square gallery tile (Instagram-style): the photo, @author, and likes/comments on hover or focus. */
export function PhotoCard({ photo, eager = false }: { photo: PhotoCardView; eager?: boolean }) {
  return (
    <Link
      href={`/galeria/${photo.id}`}
      aria-label={`${photoLabel(photo)}. ${photo.likeCount} curtidas, ${photo.commentCount} comentários`}
      className="group relative block aspect-square overflow-hidden bg-surface focus-visible:outline-offset-[-2px]"
    >
      <span className="block size-full transition-transform duration-500 ease-out group-hover:scale-[1.05]">
        <PhotoMedia
          id={photo.id}
          url={photo.url}
          width={photo.width}
          height={photo.height}
          gameSlug={photo.game?.slug}
          alt=""
          eager={eager}
        />
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center gap-5 bg-bg-deep/60 font-mono text-[13px] font-bold text-text opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className="inline-flex items-center gap-1.5">
          <HeartIcon filled /> {photo.likeCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CommentIcon /> {photo.commentCount}
        </span>
      </span>
      {photo.author ? (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate bg-bg-deep/75 px-1.5 py-0.5 font-mono text-xs text-text-2"
        >
          @{photo.author.handle}
        </span>
      ) : null}
    </Link>
  );
}
