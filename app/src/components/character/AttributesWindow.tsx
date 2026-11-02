import { SectionHead } from "@/components/ui/SectionHead";
import type { CharacterAttribute } from "@/lib/character/sheet";
import { AttributeIcon } from "./AttributeIcon";
import { formatNumber } from "./format";

type AttributesWindowProps = { attributes: CharacterAttribute[] };

/**
 * Second Tibia-style window: the 9 attributes with level, bar to the next level and where the
 * points come from. Same anatomy and grid as the skills window.
 */
export function AttributesWindow({ attributes }: AttributesWindowProps) {
  const best = attributes.reduce<CharacterAttribute | null>(
    (top, a) => (a.level > 1 && (!top || a.level > top.level || (a.level === top.level && a.points > top.points)) ? a : top),
    null,
  );
  return (
    <section>
      <SectionHead
        title="Atributos"
        aside={<span className="text-dim normal-case tracking-normal">Somam todas as plataformas.</span>}
      />
      <ul className="m-0 grid list-none grid-cols-1 gap-x-12 p-0 pt-2 min-[641px]:grid-cols-2">
        {attributes.map((attr) => {
          const isTop = attr.id === best?.id;
          const fraction = attr.span > 0 ? Math.min(1, attr.current / attr.span) : 0;
          const percent = Math.floor(fraction * 100);
          return (
            <li key={attr.id} className="border-b border-divider py-3.5">
              <div className="flex items-center gap-3">
                <AttributeIcon name={attr.id} className={`size-5 flex-none ${isTop ? "text-acc" : "text-dim"}`} />
                <span className="text-base font-semibold whitespace-nowrap">{attr.name}</span>
                <span
                  aria-hidden="true"
                  className="min-w-3 flex-1 -translate-y-1 border-b-2 border-dotted border-line-2"
                />
                <span
                  className={`min-w-[2ch] text-right text-2xl leading-none font-black font-stretch-[125%] tabular-nums ${
                    isTop ? "text-acc" : ""
                  }`}
                >
                  <span className="sr-only">Nível </span>
                  {attr.level}
                </span>
              </div>
              <p className="mt-1.5 ml-8 max-w-[60ch] text-[13.5px] text-muted">{attr.description}</p>
              <div
                role="progressbar"
                aria-label={`Progresso de ${attr.name} para o nível ${attr.level + 1}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="mt-2.5 ml-8 h-[3px] overflow-hidden rounded-[2px] bg-track"
              >
                <i
                  className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0"
                  style={{ width: `${(fraction * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="mt-1.5 ml-8 flex justify-between gap-3 font-mono text-xs text-dim-2">
                <span>vem de {attr.source}</span>
                <span>
                  {formatNumber(attr.points)} pts · faltam {formatNumber(Math.max(0, attr.span - attr.current))}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
