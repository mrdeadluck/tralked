import type { ChapterView } from "./view";

/*
 * Opening of a chapter: a wide official screenshot, the title in wide type (last words in lime) and
 * the chapter's numbers: items, collectibles by kind, achievements, missables and hours.
 */

/** Plural of a collectible kind ("sino" → "sinos", "fragmento de âmbar" → "fragmentos de âmbar"). */
export function pluralKind(kind: string): string {
  const [head, ...tail] = kind.split(" ");
  let plural: string;
  if (/ão$/.test(head)) plural = head.replace(/ão$/, "ões");
  else if (/[aeiouáéíóúâêô]$/i.test(head)) plural = `${head}s`;
  else if (/l$/.test(head)) plural = head.replace(/l$/, "is");
  else if (/m$/.test(head)) plural = head.replace(/m$/, "ns");
  else if (/[rzs]$/.test(head)) plural = `${head}es`;
  else plural = `${head}s`;
  return [plural, ...tail].join(" ");
}

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
            <b>{n}</b> {n === 1 ? kind : pluralKind(kind)}
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
