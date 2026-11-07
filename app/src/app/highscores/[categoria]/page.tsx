import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardScreen } from "@/components/highscores/BoardScreen";
import { boardFromPath, boardHref, boardTitle, METRICS } from "@/lib/highscores/boards";

export function generateStaticParams() {
  return METRICS.map((categoria) => ({ categoria }));
}

export async function generateMetadata({ params }: PageProps<"/highscores/[categoria]">): Promise<Metadata> {
  const board = boardFromPath((await params).categoria);
  if (!board) return {};
  const title = boardTitle(board);
  return {
    title: `Ranking: ${title} | Tralked`,
    description: `Ranking dos jogadores do Tralked em ${title.toLowerCase()}.`,
    alternates: { canonical: boardHref(board) },
  };
}

export default async function HighscoresCategoryPage({ params }: PageProps<"/highscores/[categoria]">) {
  const board = boardFromPath((await params).categoria);
  if (!board) notFound();
  return <BoardScreen board={board} />;
}
