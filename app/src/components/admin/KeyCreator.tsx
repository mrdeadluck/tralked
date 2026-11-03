"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { createKeyAction } from "@/app/admin/robos/actions";
import { Button } from "@/components/ui/Button";
import { BUTTON_TONE, HINT, INPUT, LABEL, SMALL_BUTTON, SMALL_BUTTON_SHAPE } from "./ui";

const SCOPES = [
  { id: "articles:write", label: "articles:write", hint: "Criar e editar notícias próprias" },
  { id: "guides:write", label: "guides:write", hint: "Criar e editar guias próprios" },
  { id: "publish", label: "publish", hint: "Publicar sem passar pela revisão" },
  { id: "media:write", label: "media:write", hint: "Enviar imagens de guias" },
] as const;

/** New bot key: name + scopes. The secret is shown once, here, with a copy button. */
export function KeyCreator() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["articles:write"]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [pending, start] = useTransition();
  const secretRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await createKeyAction({ name, scopes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret(result.secret);
      setCopied("idle");
      setName("");
      router.refresh();
      requestAnimationFrame(() => secretRef.current?.select());
    });
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("copied");
    } catch {
      setCopied("failed");
      secretRef.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {secret ? (
        <div role="status" className="flex flex-col gap-3 rounded-[2px] border border-acc/60 bg-hover px-4 py-4">
          <p className="text-[15px] font-semibold">Chave criada. Copie agora: ela não aparece de novo.</p>
          <p className={HINT}>Guardamos só o hash. Se perder, revogue e crie outra.</p>
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${id}-secret`} className="sr-only">
              Chave secreta
            </label>
            <input
              ref={secretRef}
              id={`${id}-secret`}
              readOnly
              value={secret}
              onFocus={(e) => e.currentTarget.select()}
              spellCheck={false}
              className={`${INPUT} min-w-0 flex-1 font-mono text-[13px]`}
            />
            <button type="button" onClick={copy} className={`${SMALL_BUTTON_SHAPE} h-11 ${BUTTON_TONE.default}`}>
              <span aria-live="polite">{copied === "copied" ? "Copiada" : copied === "failed" ? "Selecione e copie" : "Copiar"}</span>
            </button>
          </div>
          <div>
            <button type="button" onClick={() => setSecret(null)} className={SMALL_BUTTON}>
              Já guardei a chave
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex max-w-[420px] flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className={LABEL}>
            Nome do robô
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="redator-steam"
            aria-describedby={`${id}-name-hint`}
            className={INPUT}
          />
          <span id={`${id}-name-hint`} className={HINT}>
            Aparece como autor: “Robô {name.trim() || "nome"}”.
          </span>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${LABEL} mb-1`}>Escopos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => (
              <label key={s.id} className="flex items-start gap-2.5 rounded-[2px] border border-line-2 px-3 py-2.5 hover:border-text-3">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.id)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))}
                  className="mt-0.5 size-4 flex-none accent-(--acc)"
                />
                <span className="flex flex-col">
                  <code className="font-mono text-[13px] text-text">{s.label}</code>
                  <span className="text-[13px] text-muted">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? "Criando…" : "Criar chave"}
          </Button>
          {error ? (
            <p role="alert" className="text-[14px] text-nin">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
