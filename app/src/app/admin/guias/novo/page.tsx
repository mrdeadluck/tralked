import type { Metadata } from "next";
import Link from "next/link";
import { NewGuideForm } from "@/components/admin/NewGuideForm";
import { AdminHead, Empty } from "@/components/admin/ui";
import { requireStaffPage } from "@/lib/admin/guard";
import { gamesWithoutGuide } from "@/lib/admin/guides";

export const metadata: Metadata = { title: "Novo guia" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function NewGuidePage() {
  await requireStaffPage();
  const games = await gamesWithoutGuide();
  return (
    <>
      <AdminHead
        title="Novo guia"
        lede={
          <>
            Um guia por jogo.{" "}
            <Link href="/admin/guias" className="text-acc underline underline-offset-4 hover:no-underline">
              Voltar à lista
            </Link>
          </>
        }
      />
      {games.length === 0 ? (
        <Empty title="Todos os jogos do catálogo já têm guia." />
      ) : (
        <NewGuideForm games={games.map((g) => ({ id: g.id, name: g.name }))} />
      )}
    </>
  );
}
