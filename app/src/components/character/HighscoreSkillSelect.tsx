"use client";

import { useRouter } from "next/navigation";
import { SKILLS } from "@/lib/engine/types";

type HighscoreSkillSelectProps = { value: string };

/** Seletor de skill do ranking: navega para `/highscores?skill=...`. */
export function HighscoreSkillSelect({ value }: HighscoreSkillSelectProps) {
  const router = useRouter();
  return (
    <>
      <label
        htmlFor="highscore-skill"
        className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase"
      >
        Skill
      </label>
      <select
        id="highscore-skill"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          router.push(next === "geral" ? "/highscores" : `/highscores?skill=${next}`);
        }}
        className="h-[42px] rounded-[2px] border border-[#23252c] bg-surface-2 px-3 text-text"
      >
        <option value="geral">Nível geral</option>
        {SKILLS.map((skill) => (
          <option key={skill.id} value={skill.id}>
            {skill.name}
          </option>
        ))}
      </select>
    </>
  );
}
