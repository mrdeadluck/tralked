import { Placeholder } from "@/components/ui/Placeholder";

type GameCoverProps = {
  name: string;
  coverUrl: string | null;
  /** CSS aspect-ratio. Defaults to the preview's 16 / 10. */
  ratio?: string;
};

/** Cover art when we have it (SteamGridDB), otherwise the striped placeholder from the preview. */
export function GameCover({ name, coverUrl, ratio = "16 / 10" }: GameCoverProps) {
  if (!coverUrl) return <Placeholder label={`capa: ${name.toLowerCase()}`} ratio={ratio} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote hosts are not configured for next/image
    <img
      src={coverUrl}
      alt={`Capa de ${name}`}
      style={{ aspectRatio: ratio }}
      className="block w-full rounded-[3px] object-cover"
    />
  );
}
