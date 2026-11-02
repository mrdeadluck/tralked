import type { ContentBlock } from "@/lib/content/schema";
import type { RelatedGame } from "@/lib/queries/news";

/*
 * The robot ends many stories with a "Pra quem caça 100%" callout written when the article was,
 * often "ainda não há conquistas cadastradas". The catalog knows better at read time: the callout
 * is rewritten with the game's real count (and PlayStation platinum), or left out when there is
 * still nothing to hunt (pure; tested).
 */

const HUNT = /^\s*(\*\*)?\s*pra quem caça 100\s*%/i;

const plural = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "conquista" : "conquistas"}`;

export function withHuntCallout(blocks: ContentBlock[], game: RelatedGame | null): ContentBlock[] {
  return blocks.flatMap((block): ContentBlock[] => {
    if (block.type !== "callout" || !HUNT.test(block.text)) return [block];
    const count = game?.achievementCount ?? 0;
    if (!game || count <= 0) return [];
    const platinum = game.hasPlatinum ? ", com platina no PlayStation" : "";
    const guide = game.hasGuide ? " O guia 100% já está no ar." : "";
    return [{ ...block, text: `**Pra quem caça 100%:** ${game.name} tem ${plural(count)} no Tralked${platinum}.${guide}` }];
  });
}
