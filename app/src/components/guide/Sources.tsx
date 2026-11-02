import { SectionHead } from "@/components/ui/SectionHead";
import { isSafeHttpUrl } from "@/lib/content/url";
import type { GuideSource } from "@/lib/queries/games";

/** "Fontes": the references a (bot) guide was written from. External links open in a new tab. */
export function Sources({ sources }: { sources: GuideSource[] }) {
  // Already filtered by the query; checked again so an unsafe URL never becomes an href.
  const safe = sources.filter((s) => isSafeHttpUrl(s.url));
  if (safe.length === 0) return null;
  return (
    <section id="g-fontes" data-sec className="scroll-mt-24">
      <SectionHead title="Fontes" />
      <ol className="m-0 list-none p-0">
        {safe.map((source, i) => (
          // A guide may cite the same URL twice (two sections of one page).
          <li key={`${i}:${source.url}`} className="border-b border-divider">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-1 py-3.5"
            >
              <span className="text-[15.5px] font-bold group-hover:text-acc">
                {source.title}
                <span className="sr-only"> (abre em nova aba)</span>
              </span>
              <span className="font-mono text-xs break-all text-dim">{new URL(source.url).host}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
