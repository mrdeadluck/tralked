import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { BoardScreen } from "@/components/highscores/BoardScreen";
import { boardHref, legacySkillBoard } from "@/lib/highscores/boards";

export const metadata: Metadata = {
  title: "Highscores | Tralked",
  description:
    "Ranking dos jogadores do Tralked: nível, horas jogadas, conquistas, raras e lendárias, platinas, acervo, por plataforma e por gênero.",
};

export default function HighscoresPage({ searchParams }: PageProps<"/highscores">) {
  return (
    <>
      <Suspense fallback={null}>
        <LegacySkillRedirect searchParams={searchParams} />
      </Suspense>
      <BoardScreen board={{ metric: "nivel" }} />
    </>
  );
}

/** Old `/highscores?skill=<id>` links open that genre's board. */
async function LegacySkillRedirect({ searchParams }: { searchParams: PageProps<"/highscores">["searchParams"] }) {
  const board = legacySkillBoard((await searchParams).skill);
  if (board) permanentRedirect(boardHref(board));
  return null;
}
