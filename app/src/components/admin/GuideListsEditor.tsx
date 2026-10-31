"use client";

import { draftFromBlock, moveDraft, type BlockDraft } from "@/lib/admin/block-draft";
import type { GuideForEdit } from "@/lib/admin/guides";
import { GUIDE_NOTE_CATEGORIES } from "@/lib/content/guide-schema";
import { BlockEditor } from "./BlockEditor";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "./icons";
import { HINT, INPUT, LABEL, SELECT, SMALL_BUTTON, TEXTAREA } from "./ui";

/*
 * The list sections of the guide editor: achievement notes, collectibles and sources. Each is a
 * controlled list of drafts (form strings) converted to the guide payload on save.
 */

let counter = 0;
const nextKey = (prefix: string) => `${prefix}${(counter++).toString(36)}`;

export type NoteDraft = {
  key: string;
  /** `${platform}:${apiName}` of an achievement of the game. */
  achievement: string;
  category: string;
  spoiler: boolean;
  tip: BlockDraft[];
  /** Checklist, one item per line. */
  steps: string;
};
export type CollectibleDraft = { key: string; name: string; total: string; description: string };
export type SourceDraft = { key: string; title: string; url: string };

export const notesFrom = (guide: GuideForEdit): NoteDraft[] =>
  guide.notes.map((n) => ({
    key: nextKey("n"),
    achievement: `${n.platform}:${n.apiName}`,
    category: n.category,
    spoiler: n.spoiler,
    tip: n.tip.map(draftFromBlock),
    steps: n.steps.join("\n"),
  }));
export const collectiblesFrom = (guide: GuideForEdit): CollectibleDraft[] =>
  guide.collectibles.map((c) => ({ key: nextKey("c"), name: c.name, total: String(c.total), description: c.description }));
export const sourcesFrom = (guide: GuideForEdit): SourceDraft[] =>
  guide.sources.map((s) => ({ key: nextKey("f"), title: s.title, url: s.url }));

const CATEGORY_LABEL: Record<string, string> = {
  historia: "História",
  chefes: "Chefes",
  coletaveis: "Coletáveis",
  desafio: "Desafio",
  dlc: "DLC",
};
const PLATFORM_LABEL: Record<string, string> = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" };

function RowTools({ index, count, noun, onMove, onRemove }: {
  index: number;
  count: number;
  noun: string;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <span className="flex gap-1">
      <button type="button" className={SMALL_BUTTON} disabled={index === 0} aria-label={`Subir ${noun} ${index + 1}`} onClick={() => onMove(-1)}>
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        className={SMALL_BUTTON}
        disabled={index === count - 1}
        aria-label={`Descer ${noun} ${index + 1}`}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
      </button>
      <button
        type="button"
        className={`${SMALL_BUTTON} hover:border-nin hover:text-nin`}
        aria-label={`Remover ${noun} ${index + 1}`}
        onClick={onRemove}
      >
        <TrashIcon />
      </button>
    </span>
  );
}

function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div>
      <button type="button" className={SMALL_BUTTON} onClick={onClick} disabled={disabled}>
        <PlusIcon width={12} height={12} />
        {label}
      </button>
    </div>
  );
}

export function NotesEditor({
  id,
  value,
  onChange,
  achievements,
}: {
  id: string;
  value: NoteDraft[];
  onChange: (next: NoteDraft[]) => void;
  achievements: GuideForEdit["achievementNames"];
}) {
  const patch = (i: number, p: Partial<NoteDraft>) => onChange(value.map((n, j) => (j === i ? { ...n, ...p } : n)));
  return (
    <div className="flex flex-col gap-4">
      {value.length === 0 ? <p className={HINT}>Nenhuma nota de conquista.</p> : null}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {value.map((note, i) => (
          <li key={note.key} className="flex flex-col gap-4 rounded-[2px] border border-line-2 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-mono text-[12px] tracking-[0.08em] text-text-3 uppercase">Nota {i + 1}</h3>
              <RowTools
                index={i}
                count={value.length}
                noun="nota"
                onMove={(d) => onChange(moveDraft(value, i, d))}
                onRemove={() => onChange(value.filter((_, j) => j !== i))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-n${i}-ach`} className={LABEL}>
                  Conquista
                </label>
                <select
                  id={`${id}-n${i}-ach`}
                  value={note.achievement}
                  onChange={(e) => patch(i, { achievement: e.target.value })}
                  className={SELECT}
                >
                  <option value="">Escolha…</option>
                  {achievements.map((a) => (
                    <option key={`${a.platform}:${a.apiName}`} value={`${a.platform}:${a.apiName}`}>
                      {a.name} · {PLATFORM_LABEL[a.platform] ?? a.platform}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-n${i}-cat`} className={LABEL}>
                  Categoria
                </label>
                <select
                  id={`${id}-n${i}-cat`}
                  value={note.category}
                  onChange={(e) => patch(i, { category: e.target.value })}
                  className={SELECT}
                >
                  {GUIDE_NOTE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-3 text-[14px]">
                <input
                  type="checkbox"
                  checked={note.spoiler}
                  onChange={(e) => patch(i, { spoiler: e.target.checked })}
                  className="size-4 accent-(--acc)"
                />
                Spoiler
              </label>
            </div>
            <BlockEditor label="Dica" value={note.tip} onChange={(tip) => patch(i, { tip })} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-n${i}-steps`} className={LABEL}>
                Passo a passo <span className="font-normal text-dim">(opcional, um por linha)</span>
              </label>
              <textarea
                id={`${id}-n${i}-steps`}
                rows={3}
                value={note.steps}
                onChange={(e) => patch(i, { steps: e.target.value })}
                className={TEXTAREA}
              />
            </div>
          </li>
        ))}
      </ol>
      <AddButton
        label="Adicionar nota"
        disabled={value.length >= 1000}
        onClick={() => onChange([...value, { key: nextKey("n"), achievement: "", category: "historia", spoiler: false, tip: [], steps: "" }])}
      />
    </div>
  );
}

export function CollectiblesEditor({ id, value, onChange }: { id: string; value: CollectibleDraft[]; onChange: (next: CollectibleDraft[]) => void }) {
  const patch = (i: number, p: Partial<CollectibleDraft>) => onChange(value.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className={HINT}>Nenhum coletável.</p> : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {value.map((c, i) => (
          <li key={c.key} className="grid items-end gap-3 border-b border-line pb-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,2fr)_auto]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-c${i}-name`} className={LABEL}>
                Nome
              </label>
              <input id={`${id}-c${i}-name`} value={c.name} onChange={(e) => patch(i, { name: e.target.value })} className={INPUT} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-c${i}-total`} className={LABEL}>
                Total
              </label>
              <input
                id={`${id}-c${i}-total`}
                inputMode="numeric"
                value={c.total}
                onChange={(e) => patch(i, { total: e.target.value })}
                className={`${INPUT} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-c${i}-desc`} className={LABEL}>
                Descrição <span className="font-normal text-dim">(opcional)</span>
              </label>
              <input id={`${id}-c${i}-desc`} value={c.description} onChange={(e) => patch(i, { description: e.target.value })} className={INPUT} />
            </div>
            <RowTools
              index={i}
              count={value.length}
              noun="coletável"
              onMove={(d) => onChange(moveDraft(value, i, d))}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <AddButton
        label="Adicionar coletável"
        disabled={value.length >= 60}
        onClick={() => onChange([...value, { key: nextKey("c"), name: "", total: "", description: "" }])}
      />
    </div>
  );
}

export function SourcesEditor({ id, value, onChange }: { id: string; value: SourceDraft[]; onChange: (next: SourceDraft[]) => void }) {
  const patch = (i: number, p: Partial<SourceDraft>) => onChange(value.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className={HINT}>Nenhuma fonte.</p> : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {value.map((s, i) => (
          <li key={s.key} className="grid items-end gap-3 border-b border-line pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-f${i}-title`} className={LABEL}>
                Título
              </label>
              <input id={`${id}-f${i}-title`} value={s.title} onChange={(e) => patch(i, { title: e.target.value })} className={INPUT} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-f${i}-url`} className={LABEL}>
                Endereço
              </label>
              <input
                id={`${id}-f${i}-url`}
                type="url"
                inputMode="url"
                value={s.url}
                onChange={(e) => patch(i, { url: e.target.value })}
                placeholder="https://"
                className={`${INPUT} font-mono text-[14px]`}
              />
            </div>
            <RowTools
              index={i}
              count={value.length}
              noun="fonte"
              onMove={(d) => onChange(moveDraft(value, i, d))}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <AddButton
        label="Adicionar fonte"
        disabled={value.length >= 30}
        onClick={() => onChange([...value, { key: nextKey("f"), title: "", url: "" }])}
      />
    </div>
  );
}
