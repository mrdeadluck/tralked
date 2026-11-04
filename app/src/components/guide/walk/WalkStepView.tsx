import { Blocks } from "@/lib/content/render";
import { walkInline } from "./inline";
import { ResumeMarker } from "./ResumeMarker";
import { SpoilerCallout } from "./spoilers";
import { withSteamOnly } from "./versions";
import type { BlockView, StepView } from "./view";
import { WalkItemRow } from "./WalkItemRow";

/*
 * One step of a chapter: its number on the green line, what to do (in the order the player moves),
 * and the items found there. A missable is said once: the item's tag ("perdível · pegue agora") and
 * the robot's one sentence of cause and consequence. The chapter box lists the chapter's missables
 * and its deadline. A step box before each missable step ("⚠ Perdível no próximo passo") repeated
 * all of it, step after step (reader feedback, 2026-11-03), and was removed.
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

export function WalkStepView({ step }: { step: StepView }) {
  return (
    <article className={withSteamOnly("wk-step", step.steamOnly)} aria-label={`Passo ${step.number}`}>
      <span className="num" aria-hidden="true">
        {step.number}
      </span>
      <div className="wk-step-b">
        <ResumeMarker step={step.number} />
        {step.body.map((block, i) => (
          <StepBlock key={i} block={block} scope={`${step.scope}.${i}`} />
        ))}
        {step.items.map((item) => (
          <WalkItemRow key={item.ref} item={item} />
        ))}
      </div>
    </article>
  );
}
