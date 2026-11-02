"use client";

import { useState, useTransition } from "react";
import { toggleStep } from "@/app/jogos/[slug]/guia/actions";
import { Chip } from "@/components/ui/Chip";
import { SectionHead } from "@/components/ui/SectionHead";
import type { GuideStepView } from "@/lib/queries/games";
import { CheckLabel } from "./CheckLabel";
import { RARITY_UI } from "./format";
import { LoginNudge } from "./LoginNudge";
import { RichText } from "./RichText";

type RoadmapProps = {
  steps: GuideStepView[];
  loggedIn: boolean;
  /** Path to come back to after the login. */
  returnTo: string;
  /** True while the visitor's progress is still loading (checkboxes are inert). */
  pending?: boolean;
};

export function Roadmap({ steps, loggedIn, returnTo, pending = false }: RoadmapProps) {
  const [done, setDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(steps.map((s) => [s.id, s.done])),
  );
  const [nudgeStep, setNudgeStep] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const doneCount = steps.filter((s) => done[s.id]).length;

  function onToggle(step: GuideStepView) {
    if (!loggedIn) {
      setNudgeStep(step.id);
      return;
    }
    const previous = Boolean(done[step.id]);
    setDone((d) => ({ ...d, [step.id]: !previous }));
    startTransition(async () => {
      const result = await toggleStep(step.id);
      if (result.status === "ok") {
        setDone((d) => ({ ...d, [step.id]: result.done }));
        return;
      }
      setDone((d) => ({ ...d, [step.id]: previous }));
      if (result.status === "unauthenticated") setNudgeStep(step.id);
    });
  }

  return (
    <section id="g-rota" data-sec className="scroll-mt-24">
      <SectionHead
        title="Rota para o 100%"
        aside={
          <span className="tracking-normal text-dim normal-case" aria-live="polite">
            {doneCount} de {steps.length} etapas concluídas
          </span>
        }
      />
      <ol className="m-0 list-none p-0 [counter-reset:st]">
        {steps.map((step) => {
          const isDone = Boolean(done[step.id]);
          const count = step.achievements.length;
          return (
            <li
              key={step.id}
              className={`grid grid-cols-[56px_minmax(0,1fr)] gap-[18px] border-b border-line py-6 [counter-increment:st] before:text-[34px] before:leading-none before:font-black before:font-stretch-[125%] before:tracking-[-0.03em] before:content-[counter(st,decimal-leading-zero)] max-[640px]:grid-cols-1 max-[640px]:gap-2 ${
                isDone ? "before:text-acc" : "before:text-ph"
              }`}
            >
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[22px] leading-[1.15] font-extrabold font-stretch-[105%] tracking-[-0.02em]">
                      {step.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-3.5 font-mono text-xs text-dim">
                      <span>{step.hours}</span>
                      <span>
                        {count} {count === 1 ? "conquista" : "conquistas"}
                      </span>
                    </div>
                  </div>
                  <CheckLabel checked={isDone} disabled={pending} onChange={() => onToggle(step)}>
                    Etapa concluída
                  </CheckLabel>
                </div>
                {nudgeStep === step.id ? (
                  <LoginNudge returnTo={returnTo} className="mt-2.5" />
                ) : null}
                <RichText
                  blocks={step.blocks}
                  text={step.body}
                  cards={step.cards}
                  className="mt-2.5 text-[15.5px] text-muted"
                />
                {count > 0 ? (
                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    {step.achievements.map((a) => (
                      <Chip key={a.name} color={a.done ? "var(--acc)" : RARITY_UI[a.tier].color}>
                        {a.name}
                      </Chip>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
