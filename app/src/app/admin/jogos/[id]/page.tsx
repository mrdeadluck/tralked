import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/admin/ActionButton";
import { GameOverrideForm } from "@/components/admin/GameOverrideForm";
import { AdminHead, AdminSection } from "@/components/admin/ui";
import { GAME_SKILLS, getAdminGame } from "@/lib/admin/catalog";
import { requireStaffPage } from "@/lib/admin/guard";
import { syncNewsAction } from "../../feeds/actions";
import { syncGameMediaAction } from "../actions";

export const metadata: Metadata = { title: "Editar jogo" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function AdminGamePage({ params }: PageProps<"/admin/jogos/[id]">) {
  await requireStaffPage("admin");
  const { id } = await params;
  const game = await getAdminGame(id);
  if (!game) notFound();

  return (
    <>
      <AdminHead
        title={game.name}
        lede={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono text-[13px]">{game.slug}</span>
            <span>
              {game._count.users} {game._count.users === 1 ? "jogador tem" : "jogadores têm"} o jogo
            </span>
            <Link href={`/jogos/${game.slug}`} className="text-acc underline underline-offset-4 hover:no-underline">
              Ver no site
            </Link>
            <Link href="/admin/jogos" className="text-acc underline underline-offset-4 hover:no-underline">
              Voltar à lista
            </Link>
          </span>
        }
      />
      <AdminSection title="Gêneros e nomes">
        <GameOverrideForm
          gameId={game.id}
          skills={game.skills}
          aliases={game.aliases}
          options={GAME_SKILLS.map((s) => ({ id: s.id, name: s.name }))}
        />
      </AdminSection>
      <AdminSection title="Sincronizar">
        <ul className="m-0 flex list-none flex-col p-0">
          <li className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-3">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">Mídia oficial</span>
              <span className="text-[13px] text-muted">
                Trailers, capturas e artes do IGDB e do SteamGridDB. Hoje: {game._count.media} itens.
              </span>
            </span>
            <ActionButton action={syncGameMediaAction} input={{ gameId: game.id }} label="Buscar mídia" done="Buscando em segundo plano." />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-3">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">Notícias externas</span>
              <span className="text-[13px] text-muted">
                Lê todos os feeds ativos agora e liga as manchetes aos jogos pelo nome. Hoje: {game._count.externalNews} deste jogo.
              </span>
            </span>
            <ActionButton action={syncNewsAction} input={{}} label="Ler feeds" done="Lendo os feeds em segundo plano." />
          </li>
        </ul>
      </AdminSection>
    </>
  );
}
