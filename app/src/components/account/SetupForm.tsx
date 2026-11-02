"use client";

import { useId, useMemo, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { updatePlayerSetupAction } from "@/app/conta/setup/actions";
import { Button } from "@/components/ui/Button";
import {
  FAMILY_BY_ID,
  groupPlatforms,
  orderPlatformIds,
  PC_FIELDS,
  PC_GROUP_LABEL,
  platformMatches,
  SETUP_PLATFORMS,
  setupPlatform,
  SPEC_MAX,
  type PcFieldGroup,
  type PcFieldKey,
  type PcSpecs,
} from "@/lib/setup/catalog";

type SetupFormProps = { platforms: string[]; pc: PcSpecs | null };

type SpecValues = Record<PcFieldKey, string>;

const toValues = (pc: PcSpecs | null): SpecValues =>
  Object.fromEntries(PC_FIELDS.map(({ key }) => [key, pc?.[key] ?? ""])) as SpecValues;

const snapshot = (platforms: string[], values: SpecValues) =>
  JSON.stringify([orderPlatformIds(platforms), PC_FIELDS.map(({ key }) => values[key].trim())]);

const GROUPS: PcFieldGroup[] = ["machine", "peripherals"];

/** /conta/setup: owned platforms (searchable, grouped by family) and the PC spec sheet. */
export function SetupForm({ platforms: initialPlatforms, pc: initialPc }: SetupFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(() => new Set(initialPlatforms));
  const [values, setValues] = useState(() => toValues(initialPc));
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(() => snapshot(initialPlatforms, toValues(initialPc)));
  const [status, setStatus] = useState<{ ok: boolean; message: string; field?: string } | null>(null);
  const [saving, startSave] = useTransition();

  const groups = useMemo(
    () => groupPlatforms(SETUP_PLATFORMS.filter((platform) => platformMatches(platform, query))),
    [query],
  );
  const selectedIds = orderPlatformIds(selected);
  const dirty = snapshot(selectedIds, values) !== saved;

  function toggle(platformId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(platformId);
      else next.delete(platformId);
      return next;
    });
    setStatus(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    startSave(async () => {
      const pc = Object.fromEntries(PC_FIELDS.map(({ key }) => [key, values[key]]));
      const result = await updatePlayerSetupAction({ platforms: selectedIds, pc });
      if (!result.ok) {
        setStatus({ ok: false, message: result.error, field: result.field });
        const field = result.field?.startsWith("pc.") ? result.field.slice(3) : null;
        if (field) formRef.current?.querySelector<HTMLInputElement>(`[name="${CSS.escape(field)}"]`)?.focus();
        return;
      }
      // Show the stored values (trimmed and cleaned), which are what the profile shows.
      const nextValues = toValues(result.setup.pc);
      setSelected(new Set(result.setup.platforms));
      setValues(nextValues);
      setSaved(snapshot(result.setup.platforms, nextValues));
      setStatus({ ok: true, message: "Setup salvo. Ele já aparece no seu perfil." });
    });
  }

  const invalidField = status && !status.ok ? status.field : undefined;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-10">
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-2 text-[19px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Plataformas
        </legend>
        <p className="max-w-[62ch] text-[14px] text-muted">
          Marque todo console, portátil e PC que você tem ou já teve na estante. Eles viram selos na
          sua ficha de personagem.
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-search`} className="text-sm font-semibold">
            Buscar plataforma
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="PS2, Mega Drive, Steam Deck…"
            autoComplete="off"
            aria-controls={`${id}-list`}
            className="h-11 rounded-[2px] border border-line-2 bg-bg px-3 text-[15.5px] text-text focus:border-text"
          />
        </div>

        <SelectedStrip ids={selectedIds} onRemove={(platformId) => toggle(platformId, false)} onClear={() => {
            setSelected(new Set());
            setStatus(null);
          }}
        />

        <div id={`${id}-list`} className="flex flex-col gap-5">
          <p aria-live="polite" className="sr-only">
            {query.trim() === ""
              ? ""
              : `${groups.reduce((sum, group) => sum + group.platforms.length, 0)} plataformas encontradas`}
          </p>
          {groups.length === 0 ? (
            <p className="rounded-[2px] border border-dashed border-line-2 px-4 py-5 text-center text-sm text-muted">
              Nenhuma plataforma com “{query.trim()}”. Tente o nome do console, como “Nintendinho” ou “Series X”.
            </p>
          ) : null}
          {groups.map(({ family, platforms }) => {
            const checkedCount = platforms.filter((p) => selected.has(p.id)).length;
            return (
              <fieldset
                key={family.id}
                className="m-0 min-w-0 border-0 p-0"
                style={{ "--c": family.color } as CSSProperties}
              >
                <legend className="mb-2 flex items-center gap-2 font-mono text-xs tracking-[0.14em] text-(--c) uppercase">
                  <span aria-hidden="true" className="size-[7px] rotate-45 bg-(--c)" />
                  {family.label}
                  {checkedCount > 0 ? (
                    <span className="text-dim">
                      {" "}
                      · {checkedCount} {checkedCount === 1 ? "marcada" : "marcadas"}
                    </span>
                  ) : null}
                </legend>
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1.5 p-0">
                  {platforms.map((platform) => {
                    const checked = selected.has(platform.id);
                    return (
                      <li key={platform.id}>
                        <label
                          className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[2px] border px-3 py-2 has-focus-visible:outline-2 has-focus-visible:outline-acc ${
                            checked
                              ? "border-(--c) bg-[color-mix(in_oklch,var(--c)_12%,var(--surface))]"
                              : "border-line-2 hover:border-text-3"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggle(platform.id, event.target.checked)}
                            className="size-4 flex-none accent-(--c)"
                          />
                          <span className="min-w-0 flex-1 text-[14.5px] leading-tight">{platform.name}</span>
                          {platform.year ? (
                            <span className="flex-none font-mono text-xs text-dim tabular-nums">
                              <span className="sr-only">, </span>
                              {platform.year}
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-2 text-[19px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Ficha técnica do PC
        </legend>
        <p className="max-w-[62ch] text-[14px] text-muted">
          Tudo opcional. Só o que você preencher aparece no perfil, em texto simples, até {SPEC_MAX}{" "}
          caracteres por campo.
        </p>
        {GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <h3 className="font-mono text-xs tracking-[0.14em] text-dim-2 uppercase">{PC_GROUP_LABEL[group]}</h3>
            <div className="grid gap-x-5 gap-y-4 min-[641px]:grid-cols-2">
              {PC_FIELDS.filter((field) => field.group === group).map((field) => {
                const inputId = `${id}-${field.key}`;
                const invalid = invalidField === `pc.${field.key}`;
                return (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label htmlFor={inputId} className="text-sm font-semibold">
                      {field.label}
                    </label>
                    <input
                      id={inputId}
                      name={field.key}
                      type="text"
                      value={values[field.key]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setValues((current) => ({ ...current, [field.key]: value }));
                        setStatus(null);
                      }}
                      maxLength={SPEC_MAX}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${id}-status` : undefined}
                      className={`h-11 rounded-[2px] border bg-bg px-3 text-[15.5px] text-text focus:border-text ${
                        invalid ? "border-nin" : "border-line-2"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-4 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar setup"}
        </Button>
        <p id={`${id}-status`} aria-live="polite" className="text-sm">
          {status ? (
            <span role={status.ok ? undefined : "alert"} className={status.ok ? "text-acc" : "text-nin"}>
              {status.message}
            </span>
          ) : dirty ? (
            <span className="text-muted">Alterações não salvas.</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}

/** The marked platforms, removable one by one; visible while the search hides some of them. */
function SelectedStrip({ ids, onRemove, onClear }: { ids: string[]; onRemove: (id: string) => void; onClear: () => void }) {
  if (ids.length === 0) {
    return <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Nenhuma plataforma marcada</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
          {ids.length} {ids.length === 1 ? "marcada" : "marcadas"}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="min-h-8 cursor-pointer font-mono text-xs tracking-[0.08em] text-dim uppercase hover:text-text"
        >
          Desmarcar todas
        </button>
      </div>
      <ul aria-label="Plataformas marcadas" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {ids.flatMap((platformId) => {
          const platform = setupPlatform(platformId);
          if (!platform) return [];
          const color = FAMILY_BY_ID.get(platform.family)?.color;
          return [
            <li key={platformId}>
              <button
                type="button"
                onClick={() => onRemove(platformId)}
                aria-label={`Desmarcar ${platform.name}`}
                style={{ "--c": color } as CSSProperties}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 border border-line-2 px-2 font-mono text-xs tracking-[0.1em] text-(--c) uppercase hover:border-(--c)"
              >
                {platform.code}
                <span aria-hidden="true" className="text-dim">
                  ×
                </span>
              </button>
            </li>,
          ];
        })}
      </ul>
    </div>
  );
}
