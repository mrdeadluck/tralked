import { SectionHead } from "@/components/ui/SectionHead";
import type { CharacterSkill } from "@/lib/queries/players";
import { formatNumber } from "./format";
import { SkillIcon } from "./SkillIcon";

type SkillsWindowProps = { skills: CharacterSkill[] };

/** Janela de skills estilo Tibia: nome, linha pontilhada, nível e barra para o próximo. */
export function SkillsWindow({ skills }: SkillsWindowProps) {
  const top = skills[0] && skills[0].level > 1 ? skills[0].id : null;
  return (
    <section>
      <SectionHead
        title="Skills por gênero"
        aside={
          <span className="text-dim normal-case tracking-normal">
            Conquista rara treina mais. A XP vai para os gêneros do jogo.
          </span>
        }
      />
      <ul className="m-0 grid list-none grid-cols-1 gap-x-12 p-0 pt-2 min-[641px]:grid-cols-2">
        {skills.map((skill) => {
          const isTop = skill.id === top;
          const fraction = Math.min(1, skill.points / skill.need);
          const percent = Math.floor(fraction * 100);
          return (
            <li key={skill.id} className="border-b border-divider py-3.5">
              <div className="flex items-center gap-3">
                <SkillIcon
                  name={skill.id}
                  className={`size-5 flex-none ${isTop ? "text-acc" : "text-dim"}`}
                />
                <span className="text-base font-semibold whitespace-nowrap">{skill.name}</span>
                <span
                  aria-hidden="true"
                  className="min-w-3 flex-1 -translate-y-1 border-b-2 border-dotted border-[#34363f]"
                />
                <span
                  className={`min-w-[2ch] text-right text-2xl leading-none font-black font-stretch-[125%] tabular-nums ${
                    isTop ? "text-acc" : ""
                  }`}
                >
                  <span className="sr-only">Nível </span>
                  {skill.level}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Progresso de ${skill.name} para o nível ${skill.level + 1}`}
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
              <div className="mt-1.5 ml-8 flex justify-between font-mono text-xs text-dim-2">
                <span>
                  {percent}% para o {skill.level + 1}
                </span>
                <span>faltam {formatNumber(Math.max(0, skill.need - skill.points))}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
