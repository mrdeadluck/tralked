import Link from "next/link";
import { GameArt } from "@/components/art/GameArt";
import { RemoteImg } from "@/components/ui/RemoteImg";
import { artHues, hashSeed } from "@/lib/queries/news";
import { ArticleByline, ArticleTags, type ArticleView } from "./ArticleTags";

/**
 * The game's portrait cover when it has no landscape art: never stretched across the headline.
 * A blurred wash of it fills the box and the cover itself stands on the right like a game case.
 */
function CoverStage({ url }: { url: string }) {
  return (
    <>
      <RemoteImg
        url={url}
        alt=""
        shape="fit"
        width={264}
        height={352}
        sizes="264px"
        loading="eager"
        className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl saturate-[1.2]"
      />
      <RemoteImg
        url={url}
        alt=""
        shape="fit"
        width={300}
        height={400}
        sizes="(max-width: 767px) 1px, 300px"
        loading="eager"
        fetchPriority="high"
        className="absolute top-1/2 right-[6%] z-[1] aspect-[3/4] h-auto w-[min(32%,290px)] -translate-y-1/2 rounded-[2px_6px_6px_2px] object-cover shadow-[-6px_0_0_#0d0e12,0_30px_60px_-20px_rgba(0,0,0,.9)] transition-transform duration-700 ease-out group-hover:-translate-y-[calc(50%+6px)] motion-reduce:transition-none max-md:hidden"
      />
    </>
  );
}

/**
 * The home's main highlight: the article's landscape art (image block, game hero or screenshot)
 * under the headline; a game with only a cover gets the cover stage instead.
 */
export function HeroMain({
  article,
  sizes = "(max-width: 1000px) calc(100vw - 40px), 820px",
}: {
  article: ArticleView;
  /** Rendered width of the art (the home column by default), for the CDN copy to request. */
  sizes?: string;
}) {
  // Cards built before `wideImageUrl` existed only carry `imageUrl`: treat it as wide.
  const wide = article.wideImageUrl === undefined ? article.imageUrl : article.wideImageUrl;
  const cover = !wide ? article.imageUrl : null;
  return (
    <Link
      href={`/noticias/${article.slug}`}
      className="group relative flex min-h-[460px] flex-[1_1_560px] flex-col justify-end overflow-hidden rounded-[4px] bg-surface p-8 transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)] max-sm:min-h-[400px] max-sm:p-5"
    >
      {cover ? (
        <CoverStage url={cover} />
      ) : (
        <GameArt
          seed={hashSeed(article.slug)}
          hues={artHues(article.game?.slug, article.slug)}
          imageUrl={wide}
          figure
          light
          width={1280}
          height={720}
          sizes={sizes}
          priority
          className="absolute inset-0 object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      )}
      <span className="absolute top-[18px] right-[18px] z-[2] bg-acc px-[9px] py-[5px] font-mono text-xs font-bold tracking-[0.12em] text-bg">
        DESTAQUE
      </span>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,.1)_20%,rgba(11,12,15,.96)_88%)]"
      />
      <div className={`relative z-[2] flex flex-col gap-4 ${cover ? "max-w-[720px] md:max-w-[58%]" : "max-w-[720px]"}`}>
        <ArticleTags article={article} onImage />
        <h1
          className={`leading-[.98] font-black font-stretch-[112%] tracking-[-0.035em] text-balance ${
            cover ? "text-[clamp(30px,3.4vw,46px)]" : "text-[clamp(30px,4.2vw,56px)]"
          }`}
        >
          {article.title}
        </h1>
        {article.subtitle ? (
          <p className="max-w-[60ch] text-[17px] text-text-2">{article.subtitle}</p>
        ) : null}
        <ArticleByline article={article} className="text-xs" />
      </div>
    </Link>
  );
}
