import type { Metadata } from "next";
import { BoardScreen } from "@/components/highscores/BoardScreen";

export const metadata: Metadata = {
  title: "Highscores | Tralked",
  description:
    "Ranking dos jogadores do Tralked: nível, horas jogadas, conquistas, raras e lendárias, platinas, acervo, por plataforma e por gênero.",
};

/** Nível. Old `/highscores?skill=<id>` links are redirected to the genre board by src/proxy.ts. */
export default function HighscoresPage() {
  return <BoardScreen board={{ metric: "nivel" }} />;
}
