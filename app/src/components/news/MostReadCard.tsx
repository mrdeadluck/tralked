import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { StoryCard } from "@/lib/queries/news";

/** "Mais lidas" / "Mais visualizadas" of the home's side column: a numbered list, #1 in lime. */
export function MostReadCard({ title, stories }: { title: string; stories: StoryCard[] }) {
  return (
    <Card>
      <h2 className="border-b border-[#23252c] pb-3.5 text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
        {title}
      </h2>
      <ol className="m-0 list-none p-0">
        {stories.map((story, i) => (
          <li key={story.id} className="grid grid-cols-[30px_minmax(0,1fr)] gap-2.5 border-b border-divider py-3 last:border-b-0">
            <span
              aria-hidden="true"
              className={`text-[24px] leading-none font-black font-stretch-[125%] ${i === 0 ? "text-acc" : "text-ph"}`}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <Link href={story.href} className="text-[14.5px] leading-snug font-bold hover:text-acc">
                {story.title}
              </Link>
              <small className="mt-1 block font-mono text-xs text-dim">
                {story.kicker} · {story.when}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
