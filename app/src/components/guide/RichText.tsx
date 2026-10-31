import { Blocks } from "@/lib/content/render";
import type { AchievementCardData, ContentBlock } from "@/lib/content/schema";

type RichTextProps = {
  /** Validated ContentBlock[] (bot guides), or null for plain-text content. */
  blocks: ContentBlock[] | null;
  /** Plain text, shown when there are no blocks. */
  text: string;
  cards?: Record<string, AchievementCardData>;
  className?: string;
};

/**
 * A guide step body or achievement tip: rendered from blocks when the guide has them (React
 * elements only, never HTML), otherwise the plain text.
 */
export function RichText({ blocks, text, cards, className = "" }: RichTextProps) {
  if (blocks) {
    return (
      <div className={`text-[15.5px] text-text-2 ${className}`}>
        <Blocks blocks={blocks} achievements={cards} />
      </div>
    );
  }
  return <p className={className}>{text}</p>;
}
