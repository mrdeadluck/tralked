import type { PhotoCardView } from "@/lib/community/gallery";
import { PhotoCard } from "./PhotoCard";

type PhotoGridProps = {
  photos: PhotoCardView[];
  /** Shown when there are no photos. */
  empty: string;
  label: string;
};

/** Instagram-style grid: three square columns with hairline gaps (two on small phones). */
export function PhotoGrid({ photos, empty, label }: PhotoGridProps) {
  if (photos.length === 0) {
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
    </ul>
  );
}
