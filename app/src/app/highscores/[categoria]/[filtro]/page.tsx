import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardScreen } from "@/components/highscores/BoardScreen";
import { allBoards, boardFromPath, boardHref, boardTitle } from "@/lib/highscores/boards";

/** Every platform and genre board (`/highscores/horas/psn`, `/highscores/genero/rpg`). */
export function generateStaticParams() {
  return allBoards()
    .map((board) => boardHref(board).split("/"))
    .filter((parts) => parts.length === 4)
    .map(([, , categoria, filtro]) => ({ categoria, filtro }));
}

export async function generateMetadata({ params }: PageProps<"/highscores/[categoria]/[filtro]">): Promise<Metadata> {
  const { categoria, filtro } = await params;
  const board = boardFromPath(categoria, filtro);
  if (!board) return {};
  const title = boardTitle(board);
  return {
    title: `Ranking: ${title} | Tralked`,
    description: `Ranking dos jogadores do Tralked: ${title}.`,
    alternates: { canonical: boardHref(board) },
  };
}

export default async function HighscoresFilterPage({ params }: PageProps<"/highscores/[categoria]/[filtro]">) {
  const { categoria, filtro } = await params;
  const board = boardFromPath(categoria, filtro);
  if (!board) notFound();
  return <BoardScreen board={board} />;
}
