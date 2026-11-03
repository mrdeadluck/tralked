import { Blocks, inlineMarkup } from "@/lib/content/render";
import { SpoilerCallout, SpoilerItemName } from "./spoilers";
import type { BlockView, ItemView, StepView } from "./view";
import { WalkItemRow } from "./WalkItemRow";

/*
 * One step of a chapter: its number on the green line, what to do (in the order the player moves),
 * and the items found there. A step holding a missable item is preceded by its warning, never
 * followed: the reader learns what is lost before reaching the point of no return.
 */

function StepBlock({ block }: { block: BlockView }) {
  switch (block.type) {
    case "spoiler":
      return <SpoilerCallout id={block.id} />;
    case "paragraph":
      return <p className="wk-txt">{inlineMarkup(block.text)}</p>;
    case "list": {
      const items = block.items.map((text, i) => <li key={i}>{inlineMarkup(text)}</li>);
      return block.ordered ? <ol className="wk-txt">{items}</ol> : <ul className="wk-txt">{items}</ul>;
    }
    case "heading":
      return <h4 className="wk-step-h">{block.text}</h4>;
    case "callout":
      return (
        <aside className={block.tone === "aviso" ? "wk-callout" : "wk-callout i"} aria-label={block.tone === "aviso" ? "Atenção" : "Dica"}>
          <p>{inlineMarkup(block.text)}</p>
        </aside>
      );
    case "achievement":
      // The step's achievements are its items (with icon, rarity and the Steam check).
      return null;
    default:
      return <Blocks blocks={[block]} />;
  }
}

/** The warning before a step with missables: what is lost, and the chapter's deadline. */
function MissableWarning({ items, deadline }: { items: ItemView[]; deadline: string | null }) {
  return (
    <aside className="wk-callout wk-warn" aria-label="Aviso de perdível">
      <p>
        <b>⚠ Perdível no próximo passo:</b>{" "}
        {items.map((item, i) => (
          <span key={item.ref}>
            {i > 0 ? ", " : null}
            {item.gated ? (
              <SpoilerItemName id={`aviso-${item.ref}`} itemRef={item.ref} what="o perdível" />
            ) : (
              <strong>{item.name}</strong>
            )}
          </span>
        ))}
        . Pegue agora: depois não dá para voltar.
        {deadline ? <> Prazo: {deadline}.</> : null}
      </p>
    </aside>
  );
}

export function WalkStepView({ step, deadline }: { step: StepView; deadline: string | null }) {
  const missables = step.items.filter((item) => item.missable);
  return (
    <>
      {missables.length > 0 ? <MissableWarning items={missables} deadline={deadline} /> : null}
      <article className="wk-step" aria-label={`Passo ${step.number}`}>
        <span className="num" aria-hidden="true">
          {step.number}
        </span>
        <div className="wk-step-b">
          {step.body.map((block, i) => (
            <StepBlock key={i} block={block} />
          ))}
          {step.items.map((item) => (
            <WalkItemRow key={item.ref} item={item} />
          ))}
        </div>
      </article>
    </>
  );
}
