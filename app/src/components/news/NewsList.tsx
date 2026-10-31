"use client";

import { useState } from "react";
import { FilterChips, type FilterOption } from "@/components/ui/FilterChips";
import type { ArticleView } from "./ArticleTags";
import { NewsItem } from "./NewsItem";

const FILTERS: FilterOption[] = [
  { id: "TODAS", label: "TODAS", color: "var(--acc)" },
  { id: "PLAYSTATION", label: "PLAYSTATION", color: "var(--ps)" },
  { id: "XBOX", label: "XBOX", color: "var(--xbox)" },
  { id: "NINTENDO", label: "NINTENDO", color: "var(--nin)" },
  { id: "PC", label: "PC", color: "var(--pc)" },
];

/** Platform filter runs on the client over the server-rendered list. */
export function NewsList({ articles }: { articles: ArticleView[] }) {
  const [platform, setPlatform] = useState("TODAS");
  const visible =
    platform === "TODAS"
      ? articles
      : articles.filter((a) => a.platforms.some((p) => p === platform));

  return (
    <>
      <div className="pt-4 pb-1">
        <FilterChips
          options={FILTERS}
          value={platform}
          onChange={setPlatform}
          ariaLabel="Filtrar por plataforma"
        />
      </div>
      {visible.length > 0 ? (
        <div>
          {visible.map((article) => (
            <NewsItem key={article.slug} article={article} />
          ))}
        </div>
      ) : (
        <p className="py-10 text-[15px] text-[#8a8d96]">
          Nenhuma notícia recente nessa plataforma.
        </p>
      )}
    </>
  );
}
