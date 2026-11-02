import { PlatformChips } from "@/components/ui/PlatformChips";
import type { ArticleCard } from "@/lib/queries/news";

export type ArticleView = ArticleCard & { timeAgo: string };

/** Category label + platform chips shared by every news card. */
export function ArticleTags({
  article,
  onImage = false,
  className = "",
}: {
  article: Pick<ArticleCard, "category" | "platforms">;
  /** Chips over a hero image get a translucent dark background. */
  onImage?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 font-mono text-xs tracking-[0.1em] uppercase ${
        onImage
          ? "[&>span:not(:first-child)]:border-[rgba(236,236,230,.2)] [&>span:not(:first-child)]:bg-bg/50"
          : ""
      } ${className}`}
    >
      <span className="mr-1.5 text-acc">{article.category}</span>
      <PlatformChips platforms={article.platforms} />
    </div>
  );
}

/** "@Autor  há 2 horas" line shared by the highlight cards. */
export function ArticleByline({
  article,
  className = "",
}: {
  article: ArticleView;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap gap-3.5 font-mono text-dim ${className}`}
    >
      <span className="text-text-2">{article.authorLabel}</span>
      <span>{article.timeAgo}</span>
    </div>
  );
}
