import Link from "next/link";
import { PhotoGrid } from "@/components/community/PhotoGrid";
import { SectionHead } from "@/components/ui/SectionHead";
import type { PhotoCardView } from "@/lib/community/gallery";
import { formatNumber } from "./format";

type PlayerGalleryProps = {
  photos: PhotoCardView[];
  total: number;
  displayName: string;
  isOwner: boolean;
};

/** The player's newest gallery photos on the character sheet. */
export function PlayerGallery({ photos, total, displayName, isOwner }: PlayerGalleryProps) {
  const aside = isOwner ? (
    <Link href="/galeria" className="underline-offset-4 hover:underline">
      Enviar foto →
    </Link>
  ) : total > 0 ? (
    `${formatNumber(total)} ${total === 1 ? "foto" : "fotos"}`
  ) : null;

  return (
    <section className="flex flex-col gap-5">
      <SectionHead title="Galeria" aside={aside} />
      <PhotoGrid
        photos={photos}
        label={`Fotos de ${displayName}`}
        empty={
          isOwner
            ? "Você ainda não enviou fotos. Mostre seus jogos na galeria da comunidade."
            : `${displayName} ainda não enviou fotos.`
        }
      />
      {total > photos.length ? (
        <p className="font-mono text-xs text-dim">
          Mostrando as {photos.length} mais recentes de {formatNumber(total)}.
        </p>
      ) : null}
    </section>
  );
}
