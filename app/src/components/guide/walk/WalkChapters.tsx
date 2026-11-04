import { ChapterScene } from "./ChapterScene";
import { ChapterTimeline } from "./ChapterTimeline";
import { GreenTrail } from "./GreenTrail";
import { walkPlain } from "./inline";
import { kindLabel } from "./kinds";
import { DoneCount } from "./ProgressBits";
import { SpoilerItemName } from "./spoilers";
import type { ChapterView, ItemView } from "./view";
import { WalkStepView } from "./WalkStepView";

/*
 * The walkthrough itself: each chapter opens with its scene (from the second chapter on, the
 * journey's timeline comes back in the gap before it), then its steps along the green line beside
 * a sticky box (ticks, collectibles by kind, missables, the deadline). It closes with what can
 * still be picked up later and what cannot (Lucas: always say what can be collected later).
 */

function names(items: ItemView[], prefix: string) {
  return items.map((item, i) => (
    <span key={item.ref}>
      {i > 0 ? ", " : null}
      {item.gated ? <SpoilerItemName id={`${prefix}-${item.ref}`} itemRef={item.ref} what="o item" /> : item.name}
    </span>
  ));
}

/** "Dá para voltar depois: … Não volta: …" at the end of a chapter. */
function ChapterLater({ items }: { items: ItemView[] }) {
  const later = items.filter((i) => i.returnLater);
  // A missable the player can come back for is listed under "Dá para voltar depois" only.
  const lost = items.filter((i) => i.missable && !i.returnLater);
  if (later.length === 0 && lost.length === 0) return null;
  return (
    <aside className="wk-later" aria-label="O que dá para pegar depois">
      {later.length > 0 ? (
        <p>
          <b>Dá para voltar depois:</b> {names(later, "depois")}. O detonado lembra na hora certa.
        </p>
      ) : null}
      {lost.length > 0 ? (
        <p>
          <b className="w">Não volta:</b> {names(lost, "naovolta")}.
        </p>
      ) : null}
    </aside>
  );
}

function ChapterBox({ chapter, items }: { chapter: ChapterView; items: ItemView[] }) {
  const kinds = new Map<string, number>();
  for (const item of items)
    if (item.kind === "collectible" && item.collectibleType)
      kinds.set(item.collectibleType, (kinds.get(item.collectibleType) ?? 0) + 1);
  const missables = items.filter((i) => i.missable).length;
  return (
    <aside className="wk-cside" aria-label={`Resumo de ${chapter.title}`}>
      <div className="wk-card">
        <h4 className="wk-lbl">{chapter.title}</h4>
        <p className="wk-cnt">
          <span>Itens marcados</span>
          <DoneCount refs={items.map((i) => i.ref)} />
        </p>
        {[...kinds].map(([kind, n]) => (
          <p key={kind} className="wk-cnt">
            <span>{kindLabel(kind, n).replace(/^./, (c) => c.toUpperCase())}</span>
            <b>{n}</b>
          </p>
        ))}
        {missables > 0 ? (
          <p className="wk-cnt w">
            <span>Perdíveis</span>
            <b>{missables}</b>
          </p>
        ) : null}
      </div>
      {chapter.deadline ? (
        <div className="wk-card">
          <h4 className="wk-lbl">Prazo deste capítulo</h4>
          <p className="wk-deadline">
            Tudo que é perdível aqui fecha: <b>{walkPlain(chapter.deadline, chapter.deadlineScope)}</b>.
          </p>
        </div>
      ) : null}
    </aside>
  );
}

type WalkChaptersProps = { chapters: ChapterView[]; screenshots: string[] };

export function WalkChapters({ chapters, screenshots }: WalkChaptersProps) {
  return (
    <div className="wk-walk">
      {chapters.map((chapter, i) => {
        const items = chapter.steps.flatMap((s) => s.items);
        const image = chapter.sceneImage ?? (screenshots.length > 0 ? screenshots[i % screenshots.length] : null);
        return (
          <section key={chapter.key} id={`cap-${chapter.key}`} className="wk-chap" aria-labelledby={`cap-${chapter.key}-h`}>
            {i > 0 ? <ChapterTimeline at={i} /> : null}
            <ChapterScene chapter={chapter} index={i} count={chapters.length} image={image} />
            <div className="wk-cols">
              <div className="wk-col">
                <GreenTrail>
                  {chapter.steps.map((step) => (
                    <WalkStepView
                      key={step.number}
                      step={step}
                      deadline={chapter.deadline ? walkPlain(chapter.deadline, chapter.deadlineScope) : null}
                    />
                  ))}
                </GreenTrail>
                <ChapterLater items={items} />
              </div>
              <ChapterBox chapter={chapter} items={items} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
