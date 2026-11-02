import { CoverArt } from "@/components/art/CoverArt";
import { caseArt, steamAppIdFromUrl } from "@/lib/case-art";

type GameCoverProps = {
  name: string;
  coverUrl: string | null;
  /** Steam app id, when known: Steam's portrait art joins the fallback chain. */
  steamAppId?: number | null;
  /** Wide art (hero, store header) tried after the covers (CoverArt prints it as a case). */
  wideUrl?: string | null;
  /** The store details were fetched (no Steam portrait to guess: see lib/case-art `caseArt`). */
  portraitChecked?: boolean;
  /** CSS aspect-ratio. Defaults to the preview's 16 / 10. */
  ratio?: string;
  /** Lists and grids load the image only near the viewport (always the case now). */
  lazy?: boolean;
  /** Alt text; default "Capa de <name>". */
  alt?: string;
  /** Classes of the box; default rounded corners. */
  className?: string;
  /** Widest the cover renders (CSS px) and its `sizes`, for the CDN copy to request. */
  width?: number;
  sizes?: string;
};

/**
 * A game's cover through the shared fallback chain (lib/case-art + CoverArt): stored cover, then
 * Steam's portrait art, then wide art printed as a case, then generated art with the game's name.
 */
export function GameCover({
  name,
  coverUrl,
  steamAppId,
  wideUrl,
  portraitChecked,
  ratio = "16 / 10",
  alt,
  className = "rounded-[3px]",
  width = 320,
  sizes = "(max-width: 640px) 50vw, 320px",
}: GameCoverProps) {
  const [w, h] = ratio.split("/").map((n) => Number(n.trim()));
  const wideBox = Boolean(w && h && w > h);
  const sources = caseArt({ coverUrl, steamAppId: steamAppId ?? steamAppIdFromUrl(coverUrl), wideUrl, portraitChecked, wideBox });
  return <CoverArt name={name} sources={sources} ratio={ratio} alt={alt} className={className} width={width} sizes={sizes} />;
}
