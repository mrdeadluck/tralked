import type { CharacterAttribute } from "@/lib/character/sheet";
import type { AttributeId } from "@/lib/engine/attributes";
import { AttributeIcon } from "./AttributeIcon";
import { BuildRadar } from "./BuildRadar";
import { formatNumber } from "./format";

type AttributesWindowProps = { attributes: CharacterAttribute[] };

/**
 * The 9 attributes as the shape of the character: a radar with one axis per attribute and the
 * full list beside it (level, bar to the next level, where the points come from).
 */
export function AttributesWindow({ attributes }: AttributesWindowProps) {
  const best = attributes.reduce<CharacterAttribute | null>(
    (top, a) => (a.level > 1 && (!top || a.level > top.level || (a.level === top.level && a.points > top.points)) ? a : top),
    null,
  );
  const weakest = attributes.reduce<CharacterAttribute | null>(
    (low, a) => (!low || a.level < low.level || (a.level === low.level && a.points < low.points) ? a : low),
    null,
  );
  return (
    <BuildRadar
      title="Atributos"
      aside="O formato do seu personagem. Passe o mouse num atributo para achá-lo no gráfico."
      chartLabel={`Radar dos ${attributes.length} atributos`}
      topId={best?.id ?? null}
      icon={(id, props) => <AttributeIcon {...props} name={id as AttributeId} />}
      rows={attributes.map((attr) => ({
        id: attr.id,
        name: attr.name,
        value: attr.level,
        fraction: attr.span > 0 ? attr.current / attr.span : 0,
        left: `vem de ${attr.source}`,
        right: `${formatNumber(attr.points)} pts · faltam ${formatNumber(Math.max(0, attr.span - attr.current))}`,
        description: attr.description,
      }))}
      legend={
        <>
          {best ? (
            <span>
              Ponto forte:{" "}
              <b className="font-bold text-text">
                {best.name} {best.level}
              </b>
            </span>
          ) : null}
          {weakest && weakest.id !== best?.id ? (
            <span>
              Ponto fraco:{" "}
              <b className="font-bold text-text">
                {weakest.name} {weakest.level}
              </b>
              , {weakest.description.charAt(0).toLowerCase() + weakest.description.slice(1)}
            </span>
          ) : null}
        </>
      }
    />
  );
}
