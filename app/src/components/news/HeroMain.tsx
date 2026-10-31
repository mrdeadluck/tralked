import Link from "next/link";
import { ArticleByline, ArticleTags, type ArticleView } from "./ArticleTags";

export function HeroMain({ article }: { article: ArticleView }) {
  return (
    <Link
      href={`/noticias/${article.slug}`}
      className="group relative flex min-h-[460px] flex-[1_1_560px] flex-col justify-end overflow-hidden rounded-[4px] p-8 transition-[transform,box-shadow] duration-200 [background-image:repeating-linear-gradient(135deg,#16181d_0_12px,#1a1c22_12px_24px)] hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)]"
    >
      <span
        aria-hidden="true"
        className="absolute top-5 left-5 font-mono text-[11px] text-ph"
      >
        [ {article.imageLabel} ]
      </span>
      <span className="absolute top-[18px] right-[18px] bg-acc px-[9px] py-[5px] font-mono text-[11px] font-bold tracking-[0.12em] text-bg">
        EXCLUSIVO
      </span>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,0)_30%,rgba(11,12,15,.96)_92%)]"
      />
      <div className="relative flex max-w-[720px] flex-col gap-4">
        <ArticleTags article={article} onImage />
        <h1 className="text-[clamp(30px,4.2vw,56px)] leading-[.98] font-black font-stretch-[112%] tracking-[-0.035em]">
          {article.title}
        </h1>
        {article.subtitle ? (
          <p className="text-[17px] text-text-3">{article.subtitle}</p>
        ) : null}
        <ArticleByline article={article} className="text-xs" />
      </div>
    </Link>
  );
}
