import { inlineMarkup } from "@/lib/content/render";
import type { Walkthrough, WalkItem } from "@/lib/content/walkthrough-schema";
import type { WalkExtras } from "@/lib/queries/games";
import { SpoilerAchievement, SpoilerGate } from "./spoilers";

/*
 * "Leia isto para não perder nada": the walkthrough's read-first notes (amber for warnings, lime
 * for information), then every missable item as a chip with the chapter it belongs to. Notes and
 * items marked as spoilers, and hidden Steam achievements, stay closed until the reader opens them.
 */

type Missable = { item: WalkItem; chapter: string };

function missablesOf(walkthrough: Walkthrough): Missable[] {
  return walkthrough.chapters.flatMap((chapter) =>
    chapter.steps.flatMap((step) =>
      step.items.filter((item) => item.missable).map((item) => ({ item, chapter: chapter.title })),
    ),
  );
}

function MissableChip({ item, chapter, walk }: Missable & { walk: WalkExtras }) {
  const achievement = item.achievement ? walk.achievements[item.achievement] : undefined;
  const secret = item.spoiler || Boolean(achievement?.hidden);
  return (
    <li className="wk-mi">
      {achievement?.iconUrl && !secret ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={achievement.iconUrl} alt="" width={30} height={30} loading="lazy" />
      ) : (
        <span className="noimg" aria-hidden="true" />
      )}
      <span>
        {achievement?.hidden ? (
          <SpoilerAchievement
            id={`miss-${item.key}`}
            achievementId={achievement.id}
            name={achievement.name}
            what="o perdível"
          />
        ) : secret ? (
          <SpoilerGate id={`miss-${item.key}`} what="o perdível">
            {item.name}
          </SpoilerGate>
        ) : (
          item.name
        )}
        <em>{chapter}</em>
      </span>
    </li>
  );
}

type ReadFirstProps = { walkthrough: Walkthrough; walk: WalkExtras };

export function ReadFirst({ walkthrough, walk }: ReadFirstProps) {
  const missables = missablesOf(walkthrough);
  return (
    <section id="g-leia" className="wk-sec" aria-labelledby="g-leia-h">
      <p className="wk-lbl">Antes de começar</p>
      <h2 id="g-leia-h">Leia isto para não perder nada</h2>
      <ul className="wk-read">
        {walkthrough.readFirst.map((note, i) => {
          const text = <p>{inlineMarkup(note.text)}</p>;
          return (
            <li key={i} className={note.tone === "aviso" ? "wk-r w" : "wk-r"}>
              <b>{note.title}</b>
              {note.spoiler ? (
                <SpoilerGate id={`leia-${i}`} what={`o aviso ${note.title}`} size={24}>
                  {text}
                </SpoilerGate>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
      {missables.length > 0 ? (
        <>
          <p className="wk-lbl" style={{ marginTop: 18 }}>
            {missables.length === 1 ? "O perdível" : `Os ${missables.length} perdíveis`}
          </p>
          <ul className="wk-miss">
            {missables.map((m) => (
              <MissableChip key={m.item.key} {...m} walk={walk} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
