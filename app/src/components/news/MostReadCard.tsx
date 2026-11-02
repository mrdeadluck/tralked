import Link from "next/link";
import { SectionHead } from "@/components/ui/SectionHead";
import type { StoryCard } from "@/lib/queries/news";

/**
 * "Mais lidas" / "Mais visualizadas" of the home: a top-5 band across the page under the news and
 * the side column (in a column of its own it left a hole beside the shorter news column). Big
 * numerals, #1 in lime.
 */
export function MostReadCard({ title, stories }: { title: string; stories: StoryCard[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <SectionHead title={title} aside={<Link href="/noticias#todas">Todas as notícias →</Link>} />
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 p-0">
        {stories.map((story, i) => (
          <li key={story.id} className="border-b border-divider">
            <Link href={story.href} className="group grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-4">
              <span
                aria-hidden="true"
                className={`text-[34px] leading-[.9] font-black font-stretch-[125%] tabular-nums ${
                  i === 0 ? "text-acc" : "text-dim group-hover:text-text"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="line-clamp-3 text-[15px] leading-snug font-bold group-hover:text-acc">{story.title}</span>
                <small className="font-mono text-xs text-dim">
                  {story.kicker} · {story.when}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
