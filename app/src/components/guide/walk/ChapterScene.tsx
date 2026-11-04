import type { ReactNode } from "react";
import { kindLabel } from "./kinds";
import { Both, STEAM_ONLY } from "./versions";
import type { ChapterView, ItemView } from "./view";

/*
 * Opening of a chapter: a wide official screenshot, the title in wide type (last words in lime) and
 * the chapter's numbers: items, collectibles by kind, achievements, missables and hours. In a guide
 * with a PlayStation version, each number has that version's value too (versions.tsx).
 */

/** Collectibles by kind, most common first (at most 3 kinds). */
function kindsOf(items: ItemView[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items)
    if (item.kind === "collectible" && item.collectibleType)
      counts.set(item.collectibleType, (counts.get(item.collectibleType) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

/** "<b>n</b> word" of the meta row. */
const tally = (n: number, word: string): ReactNode => (
  <>
    <b>{n}</b> {word}
  </>
);

/**
 * One number of the meta row, by version: shown when the version has some, gone (PlayStation) when
 * only Steam has them.
 */
type MetaProps = {
  items: ItemView[];
  test: (item: ItemView) => boolean;
  word: (n: number) => string;
  className?: string;
};

function Meta({ items, test, word, className }: MetaProps) {
  const steam = items.filter(test).length;
  const ps = items.filter((i) => test(i) && !i.steamOnly).length;
  if (steam === 0) return null;
  const cls = [className, ps === 0 ? STEAM_ONLY : ""].filter(Boolean).join(" ") || undefined;
  return (
    <li className={cls}>
      <Both steam={tally(steam, word(steam))} ps={ps === steam || ps === 0 ? undefined : tally(ps, word(ps))} />
    </li>
  );
}

/**
 * `index` and `count` are the guide's own numbering, the same in both versions (as the step numbers):
 * the PlayStation version may skip a number, never renumber.
 */
type ChapterSceneProps = { chapter: ChapterView; index: number; count: number; image: string | null };

export function ChapterScene({ chapter, index, count, image }: ChapterSceneProps) {
  const items = chapter.steps.flatMap((s) => s.items);
  const [lead, ...rest] = chapter.title.trim().split(/\s+/);
  const where = chapter.region ?? `Capítulo ${index + 1} de ${count}`;

  return (
    <header className="wk-scene tk-cut">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wk-scene-bg" src={image} alt="" loading="lazy" decoding="async" />
      ) : null}
      <p className="wk-lbl">{chapter.phase > 0 ? `Etapa ${chapter.phase} · ${where}` : where}</p>
      <h3 id={`cap-${chapter.key}-h`} className="big">
        {rest.length > 0 ? (
          <>
            {lead} <span>{rest.join(" ")}</span>
          </>
        ) : (
          lead
        )}
      </h3>
      <ul className="meta">
        {items.length === 0 ? (
          <li>{tally(0, "itens")}</li>
        ) : (
          <Meta items={items} test={() => true} word={(n) => (n === 1 ? "item" : "itens")} />
        )}
        {kindsOf(items).map(([kind]) => (
          <Meta
            key={kind}
            items={items}
            test={(i) => i.kind === "collectible" && i.collectibleType === kind}
            word={(n) => kindLabel(kind, n)}
          />
        ))}
        <Meta items={items} test={(i) => Boolean(i.achievement)} word={(n) => (n === 1 ? "conquista" : "conquistas")} />
        <Meta items={items} test={(i) => i.missable} word={(n) => (n === 1 ? "perdível" : "perdíveis")} className="w" />
        <li>{chapter.hours}</li>
      </ul>
    </header>
  );
}
