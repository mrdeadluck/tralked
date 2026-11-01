import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import type { ReleaseView } from "@/lib/releases/view";
import { RELEASE_PLATFORM_COLOR, RELEASE_PLATFORM_LABEL } from "@/lib/releases/platforms";

/** Art of a release: the catalog cover, else the store capsule, else the striped placeholder. */
function ReleaseArt({ release, size }: { release: ReleaseView; size: "sm" | "md" }) {
  const box = size === "md" ? "w-[132px]" : "w-[96px]";
  const url = release.coverUrl ?? release.capsuleUrl;
  if (!url) {
    return (
      <span
        aria-hidden="true"
        style={{ backgroundImage: "var(--stripes)" }}
        className={`${box} aspect-[16/9] shrink-0 rounded-[3px] border border-line`}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked store/IGDB art, as GameCover
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${box} aspect-[16/9] shrink-0 rounded-[3px] border border-line object-cover`}
    />
  );
}

/** One release: art, name, date (or "a definir") and platforms; links to the game page. */
export function ReleaseItem({ release, size = "sm" }: { release: ReleaseView; size?: "sm" | "md" }) {
  return (
    <Link
      href={`/jogos/${release.slug}`}
      className="group flex items-center gap-3.5 rounded-[3px] py-2.5 pr-2 hover:bg-hover focus-visible:bg-hover"
    >
      <ReleaseArt release={release} size={size} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className={`truncate font-bold leading-tight group-hover:text-acc ${size === "md" ? "text-[17px]" : "text-[15px]"}`}
        >
          {release.name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11.5px] text-muted">
          {release.day ? (
            <time dateTime={release.day} className="text-text-2">
              {release.dateText}
            </time>
          ) : (
            <span className="text-text-2">{release.dateText}</span>
          )}
          {release.relative ? <span className="text-dim">{release.relative}</span> : null}
          {release.stub ? <span className="text-dim">detalhes em breve</span> : null}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {release.platforms.map((p) => (
            <Chip key={p} color={RELEASE_PLATFORM_COLOR[p]}>
              {RELEASE_PLATFORM_LABEL[p]}
            </Chip>
          ))}
        </span>
      </span>
    </Link>
  );
}
