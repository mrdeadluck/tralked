import { kindLabel } from "./kinds";
import type { ChapterView } from "./view";

/*
 * Opening of a chapter: a wide official screenshot, the title in wide type (last words in lime) and
 * the chapter's numbers: items, collectibles by kind, achievements, missables and hours.
 */

/** Collectibles of the chapter by kind, most common first (at most 3 kinds). */
function kindsOf(chapter: ChapterView): [string, number][] {
  const counts = new Map<string, number>();
  for (const step of chapter.steps)
    for (const item of step.items)
      if (item.kind === "collectible" && item.collectibleType)
        counts.set(item.collectibleType, (counts.get(item.collectibleType) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

type ChapterSceneProps = { chapter: ChapterView; index: number; count: number; image: string | null };

export function ChapterScene({ chapter, index, count, image }: ChapterSceneProps) {
  const items = chapter.steps.flatMap((s) => s.items);
  const achievements = items.filter((i) => i.achievement).length;
  const missables = items.filter((i) => i.missable).length;
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
        <li>
          <b>{items.length}</b> {items.length === 1 ? "item" : "itens"}
        </li>
        {kindsOf(chapter).map(([kind, n]) => (
          <li key={kind}>
            <b>{n}</b> {kindLabel(kind, n)}
          </li>
        ))}
        {achievements > 0 ? (
          <li>
            <b>{achievements}</b> {achievements === 1 ? "conquista" : "conquistas"}
          </li>
        ) : null}
        {missables > 0 ? (
          <li className="w">
            <b>{missables}</b> {missables === 1 ? "perdível" : "perdíveis"}
          </li>
        ) : null}
        <li>{chapter.hours}</li>
      </ul>
    </header>
  );
}
