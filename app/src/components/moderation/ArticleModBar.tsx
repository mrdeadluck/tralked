"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { moderateArticleAction } from "@/lib/moderation/actions";
import { ConfirmWithReason } from "./ConfirmWithReason";

type Option = { id: string; label: string };

type ArticleModBarProps = {
  articleId: string;
  category: string;
  featured: number;
  categories: Option[];
};

const FEATURED: { value: number; label: string }[] = [
  { value: 0, label: "Lista" },
  { value: 1, label: "Destaque lateral" },
  { value: 2, label: "Destaque principal" },
];

const SELECT =
  "h-9 cursor-pointer rounded-[2px] border border-line-2 bg-bg px-2 pr-7 font-mono text-xs tracking-[0.04em] text-text hover:border-text-3 focus:border-text disabled:cursor-wait disabled:opacity-60";
const LABEL = "flex items-center gap-2 font-mono text-xs tracking-[0.08em] text-dim uppercase";

/**
 * Newsroom bar on the article page (admin and editor only): open the editor, re-file the article
 * (category, highlight) and unpublish it. Each change is saved at once and logged.
 */
export function ArticleModBar({ articleId, category, featured, categories }: ArticleModBarProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [values, setValues] = useState({ category, featured });
  const id = useId();

  function save(input: { op: "category"; category: string } | { op: "featured"; featured: number }) {
    const previous = values;
    setValues((v) => ({ ...v, ...input }));
    start(async () => {
      const result = await moderateArticleAction({ id: articleId, ...input });
      if (!result.ok) {
        setValues(previous);
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: input.op === "category" ? "Categoria salva." : "Destaque salvo." });
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Ferramentas da redação"
      className="flex flex-col gap-3 rounded-[4px] border border-dashed border-line-2 bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="font-mono text-xs tracking-[0.12em] text-acc uppercase">Redação</span>
        <Link
          href={`/admin/noticias/${articleId}`}
          className="inline-flex h-9 items-center rounded-[2px] border border-acc px-3 font-mono text-xs font-bold tracking-[0.08em] text-acc uppercase hover:bg-acc hover:text-bg"
        >
          Editar
        </Link>
        <label htmlFor={`${id}-cat`} className={LABEL}>
          Categoria
          <select
            id={`${id}-cat`}
            value={values.category}
            disabled={busy}
            onChange={(e) => save({ op: "category", category: e.target.value })}
            className={SELECT}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-feat`} className={LABEL}>
          Destaque
          <select
            id={`${id}-feat`}
            value={values.featured}
            disabled={busy}
            onChange={(e) => save({ op: "featured", featured: Number(e.target.value) })}
            className={SELECT}
          >
            {FEATURED.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <ConfirmWithReason
          variant="button"
          label="Despublicar"
          prompt="Despublicar esta notícia? Ela volta para rascunho e sai do site."
          confirmLabel="Sim, despublicar"
          onConfirm={async (reason) => {
            const result = await moderateArticleAction({ id: articleId, op: "unpublish", reason });
            if (!result.ok) return result.error;
            // The public page is gone: continue in the editor.
            router.push(`/admin/noticias/${articleId}`);
            return null;
          }}
        />
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-acc" : "text-nin"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
