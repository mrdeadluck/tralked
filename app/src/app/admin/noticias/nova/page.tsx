import type { Metadata } from "next";
import Link from "next/link";
import { ArticleEditor } from "@/components/admin/ArticleEditor";
import { AdminHead } from "@/components/admin/ui";
import { gameOptions } from "@/lib/admin/articles";
import { requireStaffPage } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Nova notícia" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function NewArticlePage() {
  await requireStaffPage();
  const games = await gameOptions();
  return (
    <>
      <AdminHead
        title="Nova notícia"
        lede={
          <>
            Começa como rascunho. <Link href="/admin/noticias" className="text-acc underline underline-offset-4 hover:no-underline">Voltar à lista</Link>
          </>
        }
      />
      <ArticleEditor article={null} games={games} />
    </>
  );
}
