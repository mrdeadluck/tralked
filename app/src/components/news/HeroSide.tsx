import Link from "next/link";
import { ArticleByline, ArticleTags, type ArticleView } from "./ArticleTags";

export function HeroSide({ article }: { article: ArticleView }) {
  return (
    <Link
      href={`/noticias/${article.slug}`}
      style={{ backgroundImage: "var(--stripes)" }}
      className="relative flex min-h-[224px] flex-col justify-end gap-2.5 overflow-hidden rounded-[4px] p-[18px] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)]"
    >
      <span
        aria-hidden="true"
        className="absolute top-3.5 left-4 font-mono text-[10px] text-ph"
      >
        [ {article.imageLabel} ]
      </span>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,0)_20%,rgba(11,12,15,.95)_85%)]"
      />
      <ArticleTags article={article} onImage className="relative" />
      <h3 className="relative text-[19px] leading-[1.15] font-extrabold tracking-[-0.015em]">
        {article.title}
      </h3>
      <ArticleByline article={article} className="relative text-[11px]" />
    </Link>
  );
}
