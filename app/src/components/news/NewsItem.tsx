import Link from "next/link";
import { Placeholder } from "@/components/ui/Placeholder";
import { ArticleTags, type ArticleView } from "./ArticleTags";

export function NewsItem({ article }: { article: ArticleView }) {
  return (
    <Link
      href={`/noticias/${article.slug}`}
      className="-mx-3 flex flex-wrap gap-6 rounded-[3px] border-b border-line px-3 py-6 transition-colors duration-150 hover:bg-surface"
    >
      <div className="min-w-[200px] flex-[0_1_280px]">
        <Placeholder label={article.imageLabel} />
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col justify-center gap-3">
        <ArticleTags article={article} />
        <h3 className="text-[23px] leading-[1.12] font-extrabold font-stretch-[105%] tracking-[-0.02em]">
          {article.title}
        </h3>
        {article.subtitle ? (
          <p className="text-[15.5px] text-muted">{article.subtitle}</p>
        ) : null}
        <div className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
          <span className="text-text-2">{article.authorLabel}</span>
          <span>{article.timeAgo}</span>
          <span>▲ {article.likes}</span>
          <span>◼ {article.comments}</span>
          {article.humanAuthored ? (
            <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
              Autoria humana
            </span>
          ) : null}
        </div>
        {article.game ? (
          <span className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
            Abrir guia de {article.game.name} →
          </span>
        ) : null}
      </div>
    </Link>
  );
}
