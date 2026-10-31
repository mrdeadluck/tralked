import Link from "next/link";
import { GameArt } from "@/components/art/GameArt";
import { artHues, hashSeed } from "@/lib/queries/news";
import { ArticleByline, ArticleTags, type ArticleView } from "./ArticleTags";

/** The home's main highlight: the article's image (or its game's art) under the headline. */
export function HeroMain({ article }: { article: ArticleView }) {
  return (
    <Link
      href={`/noticias/${article.slug}`}
      className="group relative flex min-h-[460px] flex-[1_1_560px] flex-col justify-end overflow-hidden rounded-[4px] bg-surface p-8 transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)] max-sm:min-h-[400px] max-sm:p-5"
    >
      <GameArt
        seed={hashSeed(article.slug)}
        hues={artHues(article.game?.slug, article.slug)}
        imageUrl={article.imageUrl}
        figure
        light
        width={960}
        height={640}
        priority
        className="absolute inset-0 object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
      />
      <span className="absolute top-[18px] right-[18px] z-[1] bg-acc px-[9px] py-[5px] font-mono text-[11px] font-bold tracking-[0.12em] text-bg">
        DESTAQUE
      </span>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,.1)_20%,rgba(11,12,15,.96)_88%)]"
      />
      <div className="relative flex max-w-[720px] flex-col gap-4">
        <ArticleTags article={article} onImage />
        <h1 className="text-[clamp(30px,4.2vw,56px)] leading-[.98] font-black font-stretch-[112%] tracking-[-0.035em] text-balance">
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
