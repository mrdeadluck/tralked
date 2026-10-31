"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { saveGameOverridesAction } from "@/app/admin/jogos/actions";
import { Button } from "@/components/ui/Button";
import { HINT, LABEL, TEXTAREA } from "./ui";

type SkillOption = { id: string; name: string };

/** Skills (genres) and aliases of one game. */
export function GameOverrideForm({
  gameId,
  skills: initialSkills,
  aliases: initialAliases,
  options,
}: {
  gameId: string;
  skills: string[];
  aliases: string[];
  options: SkillOption[];
}) {
  const router = useRouter();
  const id = useId();
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [aliases, setAliases] = useState(initialAliases.join("\n"));
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    start(async () => {
      const result = await saveGameOverridesAction({
        gameId,
        skills,
        aliases: aliases.split("\n").map((a) => a.trim()).filter(Boolean),
      });
      if (!result.ok) {
        setNotice({ ok: false, text: result.error });
        return;
      }
      setNotice({
        ok: true,
        text:
          result.recomputing > 0
            ? `Salvo. Recalculando ${result.recomputing} ${result.recomputing === 1 ? "jogador" : "jogadores"} em segundo plano.`
            : "Salvo.",
      });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`${LABEL} mb-1`}>Gêneros (habilidades que o jogo treina)</legend>
        <p className={HINT}>Valem para todo o XP do jogo, inclusive conquistas antigas: os donos do jogo são recalculados.</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 min-[1100px]:grid-cols-5">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={skills.includes(o.id)}
                onChange={(e) => setSkills(e.target.checked ? [...skills, o.id] : skills.filter((s) => s !== o.id))}
                className="size-4 accent-(--acc)"
              />
              {o.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-aliases`} className={LABEL}>
          Nomes alternativos
        </label>
        <span id={`${id}-aliases-hint`} className={HINT}>
          Um por linha. Usados para ligar notícias externas e títulos de PSN/Xbox a este jogo.
        </span>
        <textarea
          id={`${id}-aliases`}
          rows={5}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          aria-describedby={`${id}-aliases-hint`}
          className={TEXTAREA}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar jogo"}
        </Button>
        <p aria-live="polite" className="text-[14px]">
          {notice ? (
            <span role={notice.ok ? undefined : "alert"} className={notice.ok ? "text-acc" : "text-nin"}>
              {notice.text}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
