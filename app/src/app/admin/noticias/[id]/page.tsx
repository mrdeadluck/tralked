import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleEditor } from "@/components/admin/ArticleEditor";
import { AdminHead, StatusBadge, When } from "@/components/admin/ui";
import { gameOptions, getArticleForEdit } from "@/lib/admin/articles";
import { requireStaffPage } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Editar notícia" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function EditArticlePage({ params }: PageProps<"/admin/noticias/[id]">) {
  await requireStaffPage();
  const { id } = await params;
  const [article, games] = await Promise.all([getArticleForEdit(id), gameOptions()]);
  if (!article) notFound();

  return (
    <>
      <AdminHead
        title="Editar notícia"
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={article.status} />
            {article.source === "bot" ? (
              <>
                <StatusBadge status="bot" label={`Robô ${article.botKeyName ?? ""}`.trim()} />
                <span>{article.reviewedAt ? "Revisada pela redação" : "Ainda sem revisão da redação"}</span>
              </>
            ) : (
              <span>@{article.author}</span>
            )}
            <span>
              Publicação: <When date={article.publishedAt} />
            </span>
            <Link href="/admin/noticias" className="text-acc underline underline-offset-4 hover:no-underline">
              Voltar à lista
            </Link>
          </span>
        }
      />
      <ArticleEditor article={article} games={games} />
    </>
  );
}
