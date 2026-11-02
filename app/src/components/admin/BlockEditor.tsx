"use client";

import { useId, useMemo, useState } from "react";
import {
  BLOCK_TYPE_LABEL,
  BLOCK_TYPES,
  emptyDraft,
  moveDraft,
  validateDrafts,
  type BlockDraft,
} from "@/lib/admin/block-draft";
import { Blocks } from "@/lib/content/render";
import { ACHIEVEMENT_PLATFORMS, CALLOUT_TONES, type ContentBlockType } from "@/lib/content/schema";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "./icons";
import { HINT, INPUT, LABEL, SELECT, SMALL_BUTTON, TEXTAREA } from "./ui";

type BlockEditorProps = {
  label: string;
  value: BlockDraft[];
  onChange: (next: BlockDraft[]) => void;
  /** Short hint under the label. */
  hint?: string;
};

const TONE_LABEL = { info: "Informação", aviso: "Aviso", spoiler: "Spoiler" } as const;
const PLATFORM_LABEL = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" } as const;

/**
 * Structured editor for ContentBlock[]: add, reorder and remove blocks, each validated with the
 * site's schema as you type, and a preview rendered by the site's own `<Blocks>`.
 */
export function BlockEditor({ label, value, onChange, hint }: BlockEditorProps) {
  const id = useId();
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const check = useMemo(() => validateDrafts(value), [value]);
  const invalid = check.results.filter((r) => !r.ok).length;

  const update = (index: number, patch: Partial<BlockDraft>) =>
    onChange(value.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  const add = (type: ContentBlockType) => onChange([...value, emptyDraft(type)]);

  return (
    <div className="flex flex-col gap-3" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span id={`${id}-label`} className={LABEL}>
            {label}
          </span>
          {hint ? <span className={HINT}>{hint}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-dim tabular-nums" aria-live="polite">
            {value.length} {value.length === 1 ? "bloco" : "blocos"}
            {invalid > 0 ? <span className="text-nin"> · {invalid} com erro</span> : null}
          </span>
          <div role="group" aria-label="Modo do editor" className="flex">
            {(["edit", "preview"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`h-9 cursor-pointer border px-3 font-mono text-xs tracking-[0.08em] uppercase first:rounded-l-[2px] last:rounded-r-[2px] ${
                  mode === m ? "border-acc bg-acc text-bg" : "border-line-2 text-text-3 hover:text-text"
                }`}
              >
                {m === "edit" ? "Editar" : "Pré-visualizar"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "preview" ? (
        <div className="rounded-[2px] border border-line bg-bg-deep px-5 py-6">
          {value.length === 0 ? (
            <p className="text-[14px] text-muted">Nada para mostrar ainda.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {check.results.map((result, i) =>
                result.ok ? (
                  <Blocks key={value[i].key} blocks={[result.block]} />
                ) : (
                  <p key={value[i].key} className="rounded-[2px] border border-dashed border-nin/60 px-3 py-2 text-[13px] text-nin">
                    Bloco {i + 1} ({BLOCK_TYPE_LABEL[value[i].type]}) tem erros e não aparece na página.
                  </p>
                ),
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {value.length === 0 ? (
            <p className="rounded-[2px] border border-dashed border-line-2 px-4 py-5 text-[14px] text-muted">
              Nenhum bloco ainda. Comece por um parágrafo.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {value.map((draft, i) => {
                const result = check.results[i];
                const base = `${id}-${i}`;
                return (
                  <li key={draft.key}>
                    <fieldset
                      className={`m-0 flex flex-col gap-3 rounded-[2px] border bg-surface px-4 pt-2 pb-4 ${
                        result.ok ? "border-line" : "border-nin/60"
                      }`}
                      aria-describedby={result.ok ? undefined : `${base}-issues`}
                    >
                      <legend className="sr-only">
                        Bloco {i + 1}: {BLOCK_TYPE_LABEL[draft.type]}
                      </legend>
                      <div className="flex items-center justify-between gap-2">
                        <span aria-hidden="true" className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
                          {String(i + 1).padStart(2, "0")} · {BLOCK_TYPE_LABEL[draft.type]}
                        </span>
                        <span className="flex gap-1">
                          <IconButton label={`Subir bloco ${i + 1}`} disabled={i === 0} onClick={() => onChange(moveDraft(value, i, -1))}>
                            <ArrowUpIcon />
                          </IconButton>
                          <IconButton
                            label={`Descer bloco ${i + 1}`}
                            disabled={i === value.length - 1}
                            onClick={() => onChange(moveDraft(value, i, 1))}
                          >
                            <ArrowDownIcon />
                          </IconButton>
                          <IconButton label={`Remover bloco ${i + 1}`} danger onClick={() => onChange(value.filter((_, j) => j !== i))}>
                            <TrashIcon />
                          </IconButton>
                        </span>
                      </div>
                      <BlockFields draft={draft} base={base} onPatch={(patch) => update(i, patch)} />
                      {!result.ok ? (
                        <ul id={`${base}-issues`} className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-nin">
                          {result.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </fieldset>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex flex-col gap-2">
            <span id={`${id}-add`} className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
              Adicionar bloco
            </span>
            <div role="group" aria-labelledby={`${id}-add`} className="flex flex-wrap gap-1.5">
              {BLOCK_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => add(type)} className={SMALL_BUTTON}>
                  <PlusIcon width={12} height={12} />
                  {BLOCK_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-[2px] border border-line-2 text-text-3 hover:border-text hover:text-text disabled:cursor-not-allowed disabled:opacity-35 ${
        danger ? "hover:border-nin hover:text-nin" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold text-text-2">
        {label}
      </label>
      {children}
      {hint ? <span className={HINT}>{hint}</span> : null}
    </div>
  );
}

const INLINE_HINT = "**negrito**, *itálico* e [link](https://…). Sem HTML.";

function BlockFields({ draft, base, onPatch }: { draft: BlockDraft; base: string; onPatch: (patch: Partial<BlockDraft>) => void }) {
  const text = (rows: number, hint?: string, fieldLabel = "Texto") => (
    <Field id={`${base}-text`} label={fieldLabel} hint={hint}>
      <textarea
        id={`${base}-text`}
        rows={rows}
        value={draft.text}
        onChange={(e) => onPatch({ text: e.target.value })}
        className={TEXTAREA}
      />
    </Field>
  );

  switch (draft.type) {
    case "paragraph":
      return text(4, INLINE_HINT);
    case "heading":
      return (
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <Field id={`${base}-level`} label="Nível">
            <select
              id={`${base}-level`}
              value={draft.level}
              onChange={(e) => onPatch({ level: e.target.value === "3" ? 3 : 2 })}
              className={SELECT}
            >
              <option value={2}>Seção (H2)</option>
              <option value={3}>Subseção (H3)</option>
            </select>
          </Field>
          <Field id={`${base}-title`} label="Título">
            <input id={`${base}-title`} value={draft.text} onChange={(e) => onPatch({ text: e.target.value })} className={INPUT} />
          </Field>
        </div>
      );
    case "list":
      return (
        <>
          {text(4, `Um item por linha. ${INLINE_HINT}`, "Itens")}
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={draft.ordered}
              onChange={(e) => onPatch({ ordered: e.target.checked })}
              className="size-4 accent-(--acc)"
            />
            Lista numerada
          </label>
        </>
      );
    case "quote":
      return (
        <>
          {text(3, INLINE_HINT)}
          <Field id={`${base}-author`} label="Autor (opcional)">
            <input id={`${base}-author`} value={draft.author} onChange={(e) => onPatch({ author: e.target.value })} className={INPUT} />
          </Field>
        </>
      );
    case "image":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id={`${base}-url`} label="URL da imagem" hint="Só https://.">
              <input
                id={`${base}-url`}
                type="url"
                inputMode="url"
                value={draft.url}
                onChange={(e) => onPatch({ url: e.target.value })}
                placeholder="https://"
                className={INPUT}
              />
            </Field>
          </div>
          <Field id={`${base}-alt`} label="Texto alternativo" hint="Descreva a imagem para quem não a vê.">
            <input id={`${base}-alt`} value={draft.alt} onChange={(e) => onPatch({ alt: e.target.value })} className={INPUT} />
          </Field>
          <Field id={`${base}-credit`} label="Crédito">
            <input id={`${base}-credit`} value={draft.author} onChange={(e) => onPatch({ author: e.target.value })} className={INPUT} />
          </Field>
        </div>
      );
    case "video":
      return (
        <>
          <Field id={`${base}-video`} label="Vídeo do YouTube" hint="Cole o link ou o ID de 11 caracteres.">
            <input id={`${base}-video`} value={draft.video} onChange={(e) => onPatch({ video: e.target.value })} className={INPUT} />
          </Field>
          <Field id={`${base}-video-title`} label="Título do vídeo" hint="Opcional. Aparece abaixo do vídeo e é lido por leitores de tela.">
            <input id={`${base}-video-title`} value={draft.alt} onChange={(e) => onPatch({ alt: e.target.value })} className={INPUT} />
          </Field>
        </>
      );
    case "callout":
      return (
        <>
          <Field id={`${base}-tone`} label="Tipo">
            <select
              id={`${base}-tone`}
              value={draft.tone}
              onChange={(e) => onPatch({ tone: e.target.value as BlockDraft["tone"] })}
              className={`${SELECT} max-w-[220px]`}
            >
              {CALLOUT_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABEL[tone]}
                </option>
              ))}
            </select>
          </Field>
          {text(3, INLINE_HINT)}
        </>
      );
    case "table":
      return (
        <>
          <Field id={`${base}-header`} label="Cabeçalho" hint='Colunas separadas por " | " (até 8).'>
            <input id={`${base}-header`} value={draft.header} onChange={(e) => onPatch({ header: e.target.value })} className={INPUT} />
          </Field>
          {text(4, 'Uma linha por linha da tabela, células separadas por " | ".', "Linhas")}
        </>
      );
    case "achievement":
      return (
        <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field id={`${base}-platform`} label="Plataforma">
            <select
              id={`${base}-platform`}
              value={draft.platform}
              onChange={(e) => onPatch({ platform: e.target.value as BlockDraft["platform"] })}
              className={SELECT}
            >
              {ACHIEVEMENT_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${base}-api`} label="apiName" hint="Precisa ser de um jogo relacionado para aparecer com raridade.">
            <input
              id={`${base}-api`}
              value={draft.apiName}
              onChange={(e) => onPatch({ apiName: e.target.value })}
              className={`${INPUT} font-mono`}
              spellCheck={false}
            />
          </Field>
        </div>
      );
    case "divider":
      return <p className={HINT}>Linha divisória entre seções.</p>;
  }
}
