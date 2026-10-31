"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveGuideAction } from "@/app/admin/guias/actions";
import { Button } from "@/components/ui/Button";
import { draftFromBlock, moveDraft, validateDrafts, type BlockDraft } from "@/lib/admin/block-draft";
import type { GuideForEdit, GuideStatus } from "@/lib/admin/guides";
import { BlockEditor } from "./BlockEditor";
import {
  CollectiblesEditor,
  collectiblesFrom,
  NotesEditor,
  notesFrom,
  SourcesEditor,
  sourcesFrom,
  type CollectibleDraft,
  type NoteDraft,
  type SourceDraft,
} from "./GuideListsEditor";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "./icons";
import { AdminSection, HINT, INPUT, LABEL, SELECT, SMALL_BUTTON, TEXTAREA } from "./ui";

/** `id`: the stored step (readers' checkmarks follow it); none for a step added in this session. */
type StepDraft = { key: string; id?: string; title: string; hours: string; achievements: string; body: BlockDraft[] };

const STATUS_OPTIONS: { value: GuideStatus; label: string }[] = [
  { value: "draft", label: "Rascunho" },
  { value: "review", label: "Em revisão" },
  { value: "published", label: "Publicado" },
];

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const words = (text: string) => text.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
let stepCounter = 0;
const stepKey = () => `s${(stepCounter++).toString(36)}`;

const FACTS: { key: keyof GuideForEdit["facts"]; label: string; numeric: boolean; hint?: string }[] = [
  { key: "difficulty", label: "Dificuldade (1–10)", numeric: true },
  { key: "hoursMin", label: "Horas (mín.)", numeric: true },
  { key: "hoursMax", label: "Horas (máx.)", numeric: true },
  { key: "playthroughs", label: "Zeradas", numeric: false, hint: "Ex.: 2 (Ritual e Banishment)" },
  { key: "missables", label: "Perdíveis", numeric: true },
  { key: "online", label: "Online", numeric: true },
];

/**
 * Guide editor: workflow, fact sheet, overview, warnings, introduction, steps (with blocks),
 * achievement notes, collectibles and sources.
 */
export function GuideEditor({ guide }: { guide: GuideForEdit }) {
  const router = useRouter();
  const id = useId();
  const [status, setStatus] = useState<GuideStatus>(guide.status);
  const [version, setVersion] = useState(guide.version);
  const [summary, setSummary] = useState("");
  const [facts, setFacts] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(guide.facts).map(([k, v]) => [k, String(v)])),
  );
  const [overview, setOverview] = useState(guide.overview.join("\n"));
  const [warnings, setWarnings] = useState(guide.warnings.join("\n"));
  const [body, setBody] = useState<BlockDraft[]>(() => guide.body.map(draftFromBlock));
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    guide.steps.map((s) => ({
      key: stepKey(),
      id: s.id,
      title: s.title,
      hours: s.hours,
      achievements: s.achievements.join("\n"),
      body: s.body.map(draftFromBlock),
    })),
  );
  const [notes, setNotes] = useState<NoteDraft[]>(() => notesFrom(guide));
  const [collectibles, setCollectibles] = useState<CollectibleDraft[]>(() => collectiblesFrom(guide));
  const [sources, setSources] = useState<SourceDraft[]>(() => sourcesFrom(guide));
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();
  const bodyCheck = useMemo(() => validateDrafts(body), [body]);

  const patchStep = (index: number, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stepBlocks = steps.map((s) => validateDrafts(s.body).blocks);
    const badStep = stepBlocks.findIndex((b) => b === null);
    const tipBlocks = notes.map((n) => validateDrafts(n.tip).blocks);
    const badNote = tipBlocks.findIndex((b) => b === null);
    const unchosen = notes.findIndex((n) => !n.achievement);
    const problem = !bodyCheck.blocks
      ? "A introdução tem blocos com erro."
      : badStep >= 0
        ? `A etapa ${badStep + 1} tem blocos com erro.`
        : unchosen >= 0
          ? `Escolha a conquista da nota ${unchosen + 1}.`
          : badNote >= 0
            ? `A dica da nota ${badNote + 1} tem blocos com erro.`
            : null;
    if (problem) {
      setNotice({ ok: false, text: problem });
      return;
    }
    setNotice(null);
    // The editor stays usable while saving: remember which local step each sent position was.
    const sentKeys = steps.map((s) => s.key);
    startSave(async () => {
      const result = await saveGuideAction({
        id: guide.id,
        status,
        version,
        changeSummary: summary,
        facts: Object.fromEntries(FACTS.map((f) => [f.key, f.numeric ? Number(facts[f.key]) : facts[f.key]])),
        overview: lines(overview),
        warnings: lines(warnings),
        body: bodyCheck.blocks,
        steps: steps.map((s, i) => ({
          ...(s.id ? { id: s.id } : {}),
          title: s.title,
          hours: s.hours,
          body: stepBlocks[i],
          achievements: words(s.achievements),
        })),
        notes: notes.map((n, i) => {
          const at = n.achievement.indexOf(":");
          return {
            platform: n.achievement.slice(0, at),
            apiName: n.achievement.slice(at + 1),
            category: n.category,
            spoiler: n.spoiler,
            tip: tipBlocks[i],
            steps: lines(n.steps),
          };
        }),
        collectibles: collectibles.map((c) => ({
          name: c.name,
          total: Number(c.total),
          ...(c.description.trim() ? { description: c.description } : {}),
        })),
        sources: sources.map((x) => ({ title: x.title, url: x.url.trim() })),
      });
      if (!result.ok) {
        setNotice({ ok: false, text: result.field ? `${result.error} (${fieldLabel(result.field)})` : result.error });
        return;
      }
      setSummary("");
      // New steps now exist: keep their ids so the next save updates them instead of recreating them.
      // Matched by the local key, not the position: steps may have moved while the save ran.
      const savedId = new Map(sentKeys.map((key, i) => [key, result.stepIds[i]]));
      setSteps((list) => list.map((s) => ({ ...s, id: savedId.get(s.key) ?? s.id })));
      setNotice({ ok: true, text: `Salvo como revisão ${result.revision}.` });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10" noValidate>
      <AdminSection title="Publicação">
        <div className="grid gap-4 sm:grid-cols-[200px_160px_minmax(0,1fr)]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-status`} className={LABEL}>
              Status
            </label>
            <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as GuideStatus)} className={SELECT}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-version`} className={LABEL}>
              Versão
            </label>
            <input id={`${id}-version`} value={version} onChange={(e) => setVersion(e.target.value)} className={`${INPUT} font-mono`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-summary`} className={LABEL}>
              O que mudou <span className="font-normal text-dim">(opcional, aparece em “Revisões”)</span>
            </label>
            <input id={`${id}-summary`} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} className={INPUT} />
          </div>
        </div>
      </AdminSection>

      <AdminSection title="Ficha">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 min-[1100px]:grid-cols-6">
          {FACTS.map((f) => (
            <div key={f.key} className={`flex flex-col gap-1.5 ${f.numeric ? "" : "col-span-2 sm:col-span-1 min-[1100px]:col-span-1"}`}>
              <label htmlFor={`${id}-${f.key}`} className={LABEL}>
                {f.label}
              </label>
              <input
                id={`${id}-${f.key}`}
                value={facts[f.key]}
                inputMode={f.numeric ? "numeric" : undefined}
                onChange={(e) => setFacts({ ...facts, [f.key]: e.target.value })}
                className={`${INPUT} ${f.numeric ? "font-mono tabular-nums" : ""}`}
                placeholder={f.hint}
              />
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Visão geral e avisos">
        <div className="grid gap-4 min-[900px]:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-overview`} className={LABEL}>
              Visão geral
            </label>
            <span className={HINT}>Um item por linha.</span>
            <textarea id={`${id}-overview`} rows={6} value={overview} onChange={(e) => setOverview(e.target.value)} className={TEXTAREA} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-warnings`} className={LABEL}>
              Avisos
            </label>
            <span className={HINT}>Um aviso por linha (conquistas perdíveis, bugs…).</span>
            <textarea id={`${id}-warnings`} rows={6} value={warnings} onChange={(e) => setWarnings(e.target.value)} className={TEXTAREA} />
          </div>
        </div>
        <BlockEditor label="Introdução" hint="Opcional: texto antes das etapas." value={body} onChange={setBody} />
      </AdminSection>

      <AdminSection title="Etapas" aside={`${steps.length} ${steps.length === 1 ? "etapa" : "etapas"}`}>
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {steps.map((step, i) => (
            <li key={step.key} className="flex flex-col gap-4 rounded-[2px] border border-line-2 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-[12px] tracking-[0.08em] text-text-3 uppercase">Etapa {i + 1}</h3>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === 0}
                    aria-label={`Subir etapa ${i + 1}`}
                    onClick={() => setSteps((list) => moveDraft(list, i, -1))}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === steps.length - 1}
                    aria-label={`Descer etapa ${i + 1}`}
                    onClick={() => setSteps((list) => moveDraft(list, i, 1))}
                  >
                    <ArrowDownIcon />
                  </button>
                  <button
                    type="button"
                    className={`${SMALL_BUTTON} hover:border-nin hover:text-nin`}
                    aria-label={`Remover etapa ${i + 1}`}
                    onClick={() => {
                      const prompt = step.id
                        ? `Remover a etapa ${i + 1}? Ao salvar, os leitores que marcaram esta etapa perdem só essa marca; as outras etapas mantêm as delas.`
                        : `Remover a etapa ${i + 1}? Ela ainda não foi salva.`;
                      if (window.confirm(prompt)) {
                        setSteps((list) => list.filter((_, j) => j !== i));
                      }
                    }}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-s${i}-title`} className={LABEL}>
                    Título
                  </label>
                  <input
                    id={`${id}-s${i}-title`}
                    value={step.title}
                    onChange={(e) => patchStep(i, { title: e.target.value })}
                    className={INPUT}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-s${i}-hours`} className={LABEL}>
                    Tempo
                  </label>
                  <input
                    id={`${id}-s${i}-hours`}
                    value={step.hours}
                    onChange={(e) => patchStep(i, { hours: e.target.value })}
                    placeholder="35 a 45 h"
                    className={INPUT}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-s${i}-ach`} className={LABEL}>
                  Conquistas desta etapa
                </label>
                <textarea
                  id={`${id}-s${i}-ach`}
                  rows={2}
                  value={step.achievements}
                  onChange={(e) => patchStep(i, { achievements: e.target.value })}
                  spellCheck={false}
                  aria-describedby={`${id}-ach-hint`}
                  className={`${TEXTAREA} font-mono text-[13px]`}
                />
              </div>
              <BlockEditor label="Texto da etapa" value={step.body} onChange={(next) => patchStep(i, { body: next })} />
            </li>
          ))}
        </ol>
        <p id={`${id}-ach-hint`} className={HINT}>
          Conquistas: apiNames Steam do jogo, separados por espaço, vírgula ou linha. Reordenar, incluir ou
          remover etapas mantém as marcas que os leitores fizeram em cada etapa.
        </p>
        {guide.achievementNames.length > 0 ? (
          <details className="text-[13px]">
            <summary className="cursor-pointer font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase hover:text-text">
              Ver apiNames Steam do jogo ({guide.achievementNames.filter((a) => a.platform === "steam").length})
            </summary>
            <ul className="m-0 mt-2 grid max-h-[280px] list-none gap-x-6 gap-y-1 overflow-auto p-0 sm:grid-cols-2">
              {guide.achievementNames
                .filter((a) => a.platform === "steam")
                .map((a) => (
                <li key={a.apiName} className="flex justify-between gap-3 border-b border-line py-1">
                  <span className="truncate text-text-2">{a.name}</span>
                  <code className="font-mono text-[12px] text-dim">{a.apiName}</code>
                </li>
                ))}
            </ul>
          </details>
        ) : null}
        <div>
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={steps.length >= 60}
            onClick={() => setSteps((list) => [...list, { key: stepKey(), title: "", hours: "", achievements: "", body: [] }])}
          >
            <PlusIcon width={12} height={12} />
            Adicionar etapa
          </button>
        </div>
      </AdminSection>

      <AdminSection title="Notas de conquista" aside={`${notes.length} ${notes.length === 1 ? "nota" : "notas"}`}>
        <NotesEditor id={`${id}-notes`} value={notes} onChange={setNotes} achievements={guide.achievementNames} />
      </AdminSection>

      <AdminSection title="Coletáveis">
        <CollectiblesEditor id={`${id}-col`} value={collectibles} onChange={setCollectibles} />
      </AdminSection>

      <AdminSection title="Fontes">
        <SourcesEditor id={`${id}-src`} value={sources} onChange={setSources} />
      </AdminSection>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-4 border-t border-line-2 bg-bg/95 py-4">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar guia"}
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

/** "steps.2.achievements" → "etapa 3, conquistas". */
function fieldLabel(field: string): string {
  const [head, index, tail] = field.split(".");
  if (head === "notes" && index !== undefined) return `nota ${Number(index) + 1}`;
  if (head === "collectibles" && index !== undefined) return `coletável ${Number(index) + 1}`;
  if (head === "sources" && index !== undefined) return `fonte ${Number(index) + 1}`;
  if (head === "steps" && index !== undefined) {
    const part = { title: "título", hours: "tempo", body: "texto", achievements: "conquistas" }[tail ?? ""] ?? "";
    return `etapa ${Number(index) + 1}${part ? `, ${part}` : ""}`;
  }
  return { facts: "ficha", version: "versão", overview: "visão geral", warnings: "avisos", body: "introdução" }[head] ?? field;
}
