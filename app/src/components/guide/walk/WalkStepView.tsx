import { Blocks } from "@/lib/content/render";
import { walkInline } from "./inline";
import { SpoilerCallout, SpoilerItemName } from "./spoilers";
import type { BlockView, ItemView, StepView } from "./view";
import { WalkItemRow } from "./WalkItemRow";

/*
 * One step of a chapter: its number on the green line, what to do (in the order the player moves),
 * and the items found there. A step holding a missable item is preceded by its warning, never
 * followed: the reader learns what is lost before reaching the point of no return.
 */

/** One body block; `scope` names its inline spoiler spans (view.ts). */
function StepBlock({ block, scope }: { block: BlockView; scope: string }) {
  switch (block.type) {
    case "spoiler":
      return <SpoilerCallout id={block.id} />;
    case "paragraph":
      return <p className="wk-txt">{walkInline(block.text, scope)}</p>;
    case "list": {
      const items = block.items.map((text, i) => <li key={i}>{walkInline(text, `${scope}.${i}`)}</li>);
      return block.ordered ? <ol className="wk-txt">{items}</ol> : <ul className="wk-txt">{items}</ul>;
    }
    case "heading":
      return <h4 className="wk-step-h">{block.text}</h4>;
    case "callout":
      return (
        <aside className={block.tone === "aviso" ? "wk-callout" : "wk-callout i"} aria-label={block.tone === "aviso" ? "Atenção" : "Dica"}>
          <p>{walkInline(block.text, scope)}</p>
        </aside>
      );
    case "quote":
      return (
        <figure className="wk-quote">
          <blockquote>{walkInline(block.text, scope)}</blockquote>
          {block.author ? <figcaption>{block.author}</figcaption> : null}
        </figure>
      );
    case "table":
      return (
        <div className="wk-table" role="region" aria-label="Tabela" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{walkInline(cell, `${scope}.${r}.${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "achievement":
      // The step's achievements are its items (with icon, rarity and the Steam check).
      return null;
    default:
      // Image, video and divider: no inline text.
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
            <StepBlock key={i} block={block} scope={`${step.scope}.${i}`} />
          ))}
          {step.items.map((item) => (
            <WalkItemRow key={item.ref} item={item} />
          ))}
        </div>
      </article>
    </>
  );
}
