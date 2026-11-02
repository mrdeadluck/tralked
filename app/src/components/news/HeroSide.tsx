import Link from "next/link";
import { GameArt } from "@/components/art/GameArt";
import { artHues, hashSeed } from "@/lib/queries/news";
import { ArticleByline, ArticleTags, type ArticleView } from "./ArticleTags";

/** A side highlight of the home: art (article image, game art or generated) under the headline. */
export function HeroSide({ article }: { article: ArticleView }) {
  return (
    <Link
      href={`/noticias/${article.slug}`}
      className="group relative flex min-h-[224px] flex-col justify-end gap-2.5 overflow-hidden rounded-[4px] bg-surface p-[18px] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)]"
    >
      <GameArt
        seed={hashSeed(article.slug)}
        hues={artHues(article.game?.slug, article.slug)}
        imageUrl={article.imageUrl}
        width={520}
        height={320}
        className="absolute inset-0 object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,.05)_10%,rgba(11,12,15,.95)_80%)]"
      />
      <ArticleTags article={article} onImage className="relative" />
      <h2 className="relative text-[19px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance">
        {article.title}
      </h2>
      <ArticleByline article={article} className="relative text-xs" />
    </Link>
  );
}
