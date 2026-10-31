"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { loginHref } from "@/components/guide/format";
import { startThread } from "@/lib/community/actions";
import { BODY_MAX, TITLE_MAX } from "@/lib/community/text";

type NewThreadFormProps = {
  /** Category slug or game slug of the section the thread goes to. */
  section: string;
  sectionName: string;
  loggedIn: boolean;
  returnTo: string;
  pending?: boolean;
};

/** "Novo tópico": a disclosure with title + first message; opens the new thread on success. */
export function NewThreadForm({ section, sectionName, loggedIn, returnTo, pending = false }: NewThreadFormProps) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <a
        href={pending ? undefined : loginHref(returnTo)}
        aria-disabled={pending || undefined}
        className="inline-flex h-11 items-center justify-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] aria-disabled:opacity-45"
      >
        Entrar para criar tópico
      </a>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await startThread({ section, title: String(data.get("title") ?? ""), body: String(data.get("body") ?? "") });
      if (result.status === "ok") {
        router.push(`/forum/t/${result.threadId}`);
        return;
      }
      setError({ field: "field" in result ? result.field : undefined, message: result.message });
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
      >
        Novo tópico
      </button>
    );
  }

  const titleError = error?.field === "title" ? error.message : null;
  const bodyError = error?.field === "body" ? error.message : null;
  const otherError = error && !titleError && !bodyError ? error.message : null;

  return (
    <form onSubmit={onSubmit} aria-label={`Novo tópico em ${sectionName}`} className="flex flex-col gap-4 rounded-[4px] border border-line-2 bg-surface p-5">
      <label htmlFor={`${id}-title`} className="flex flex-col gap-1.5 text-[13px] text-muted">
        Título
        <input
          id={`${id}-title`}
          name="title"
          required
          minLength={5}
          maxLength={TITLE_MAX}
          autoFocus
          aria-invalid={titleError ? true : undefined}
          className="h-11 rounded-[2px] border border-line-2 bg-bg px-3 text-[16px] text-text"
        />
        {titleError ? (
          <span role="alert" className="text-[13px] text-nin">
            {titleError}
          </span>
        ) : null}
      </label>
      <label htmlFor={`${id}-body`} className="flex flex-col gap-1.5 text-[13px] text-muted">
        Mensagem
        <textarea
          id={`${id}-body`}
          name="body"
          required
          rows={5}
          maxLength={BODY_MAX}
          aria-invalid={bodyError ? true : undefined}
          className="resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[15.5px] leading-relaxed text-text"
        />
        {bodyError ? (
          <span role="alert" className="text-[13px] text-nin">
            {bodyError}
          </span>
        ) : null}
      </label>
      {otherError ? (
        <p role="alert" className="text-[13px] text-nin">
          {otherError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="h-10 cursor-pointer rounded-[2px] border border-acc bg-acc px-4 font-mono text-[11px] font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Publicando…" : "Publicar tópico"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-10 cursor-pointer rounded-[2px] border border-line-2 px-4 font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase hover:border-text"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
