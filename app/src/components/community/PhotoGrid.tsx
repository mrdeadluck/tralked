import type { PhotoCardView } from "@/lib/community/gallery";
import { PhotoCard } from "./PhotoCard";

type PhotoGridProps = {
  photos: PhotoCardView[];
  /** Shown when there are no photos. */
  empty: string;
  label: string;
  /** With fewer photos than this, the free cells become invitations to send one (to `invite.href`). */
  invite?: { href: string; min: number };
};

const INVITES = ["Envie sua captura", "Seu melhor chefe", "Sua cena favorita"];

/** Instagram-style grid: three square columns with hairline gaps (two on small phones). */
export function PhotoGrid({ photos, empty, label, invite }: PhotoGridProps) {
  const free = invite ? Math.max(0, invite.min - photos.length) : 0;
  if (photos.length === 0 && free === 0) {
    return (
      <p className="border border-dashed border-line-2 px-6 py-14 text-center text-[15px] text-muted">{empty}</p>
    );
  }
  return (
    <ul aria-label={label} className="m-0 grid list-none grid-cols-3 gap-1 p-0 max-[420px]:grid-cols-2">
      {photos.map((photo, i) => (
        <li key={photo.id}>
          <PhotoCard photo={photo} eager={i < 6} />
        </li>
      ))}
      {invite
        ? INVITES.slice(0, free).map((text) => (
            <li key={text}>
              <a
                href={invite.href}
                className="grid aspect-square place-items-center border border-dashed border-line-2 p-2 text-center text-[14px] text-muted transition-colors hover:border-acc hover:text-text"
              >
                <span>
                  <b aria-hidden="true" className="block text-[22px] text-acc">
                    +
                  </b>
                  {text}
                </span>
              </a>
            </li>
          ))
        : null}
    </ul>
  );
}
