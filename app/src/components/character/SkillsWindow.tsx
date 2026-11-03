import type { CharacterSkill } from "@/lib/queries/players";
import { BuildRadar } from "./BuildRadar";
import { formatNumber } from "./format";
import { SkillIcon } from "./SkillIcon";

type SkillsWindowProps = { skills: CharacterSkill[] };

/**
 * Skills by genre with the same treatment as the attributes: a radar of every skill and the list
 * beside it (level, bar and the way to the next level). The strongest skill is in lime.
 */
export function SkillsWindow({ skills }: SkillsWindowProps) {
  const top = skills[0] && skills[0].level > 1 ? skills[0] : null;
  const fraction = (s: CharacterSkill) => (s.need > 0 ? Math.min(1, s.points / s.need) : 0);
  // The skill closest to its next level (other than the strongest one).
  const rising = skills
    .filter((s) => s.id !== top?.id && s.points > 0)
    .reduce<CharacterSkill | null>((best, s) => (!best || fraction(s) > fraction(best) ? s : best), null);
  return (
    <BuildRadar
      title="Skills por gênero"
      aside="Conquista rara treina mais. A XP vai para os gêneros de cada jogo. Passe o mouse para achar no gráfico."
      chartLabel={`Radar das ${skills.length} skills por gênero`}
      topId={top?.id ?? null}
      icon={(id, props) => <SkillIcon {...props} name={id} />}
      rows={skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        value: skill.level,
        fraction: fraction(skill),
        left: `${Math.floor(fraction(skill) * 100)}% para o ${skill.level + 1}`,
        right: `faltam ${formatNumber(Math.max(0, skill.need - skill.points))}`,
      }))}
      legend={
        <>
          {top ? (
            <span>
              Mais forte:{" "}
              <b className="font-bold text-text">
                {top.name} {top.level}
              </b>
            </span>
          ) : null}
          {rising ? (
            <span>
              Quase subindo: <b className="font-bold text-text">{rising.name}</b>,{" "}
              {Math.floor(fraction(rising) * 100)}% para o nível {rising.level + 1}
            </span>
          ) : null}
        </>
      }
    />
  );
}
