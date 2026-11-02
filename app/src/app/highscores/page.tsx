import type { Metadata } from "next";
import { BoardScreen } from "@/components/highscores/BoardScreen";
import { MIN_PODIUM, type Board } from "@/lib/highscores/boards";
import { getBoardCached } from "@/lib/highscores/cached";

export const metadata: Metadata = {
  title: "Ranking | Tralked",
  description:
    "Ranking dos jogadores do Tralked: nível, XP da semana, horas jogadas, conquistas, raras e lendárias, platinas, acervo, por plataforma e por gênero.",
};

/**
 * Nível, unless it cannot fill a podium yet: then Esta semana, the board anyone can climb this
 * week (when it has someone in it). The Nível tab keeps its own address, /highscores/nivel.
 * Old `/highscores?skill=<id>` links are redirected to the genre board by src/proxy.ts.
 */
export default async function HighscoresPage() {
  const nivel = await getBoardCached("nivel");
  let board: Board = { metric: "nivel" };
  if (nivel.rows.length < MIN_PODIUM) {
    const semana = await getBoardCached("semana");
    if (semana.rows.length > 0) board = { metric: "semana" };
  }
  return <BoardScreen board={board} />;
}
