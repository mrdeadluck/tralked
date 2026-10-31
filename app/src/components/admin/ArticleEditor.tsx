"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveArticleAction } from "@/app/admin/noticias/actions";
import { Button } from "@/components/ui/Button";
import type { ArticleForEdit, ArticleStatus, GameOption } from "@/lib/admin/articles";
import { draftFromBlock, validateDrafts, type BlockDraft } from "@/lib/admin/block-draft";
import { ARTICLE_CATEGORIES, ARTICLE_PLATFORMS } from "@/lib/api/article-schema";
import { slugify } from "@/lib/community/text";
import { BlockEditor } from "./BlockEditor";
import { GamePicker } from "./GamePicker";
import { HINT, INPUT, LABEL, SELECT, TEXTAREA } from "./ui";

const STATUS_OPTIONS: { value: ArticleStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Rascunho", hint: "Só a redação vê." },
  { value: "review", label: "Em revisão", hint: "Na fila de revisão, esperando um editor." },
  { value: "published", label: "Publicada", hint: "No ar em /noticias." },
  { value: "archived", label: "Arquivada", hint: "Fora do ar, guardada." },
];
const CATEGORY_LABEL = { GAMES: "Games", GUIAS: "Guias", COMUNIDADE: "Comunidade" } as const;
const PLATFORM_LABEL = { PC: "PC", PLAYSTATION: "PlayStation", XBOX: "Xbox", NINTENDO: "Nintendo" } as const;
const FEATURED_LABEL = ["Lista", "Destaque lateral", "Destaque principal"];

/** Article editor: fields, block content with preview, workflow status and related games. */
export function ArticleEditor({ article, games }: { article: ArticleForEdit | null; games: GameOption[] }) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [subtitle, setSubtitle] = useState(article?.subtitle ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [category, setCategory] = useState(article?.category ?? "GAMES");
  const [platforms, setPlatforms] = useState<string[]>(article?.platforms ?? []);
  const [imageLabel, setImageLabel] = useState(article?.imageLabel ?? "");
  const [featured, setFeatured] = useState(article?.featured ?? 0);
  const [status, setStatus] = useState<ArticleStatus>(article?.status ?? "draft");
  const [gameIds, setGameIds] = useState<string[]>(article?.gameIds ?? []);
  const [drafts, setDrafts] = useState<BlockDraft[]>(() => (article?.blocks ?? []).map(draftFromBlock));
  const [notice, setNotice] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const [saving, startSave] = useTransition();
  const check = useMemo(() => validateDrafts(drafts), [drafts]);

  const slugLocked = article?.slugLocked ?? false;
  const invalid = (field: string) => (notice && !notice.ok && notice.field?.startsWith(field)) || undefined;

  function onTitle(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.blocks) {
      setNotice({ ok: false, text: "Há blocos com erro. Corrija os campos marcados em vermelho.", field: "blocks" });
      return;
    }
    setNotice(null);
    startSave(async () => {
      const result = await saveArticleAction({
        ...(article ? { id: article.id } : {}),
        title,
        slug,
        subtitle,
        excerpt,
        category,
        platforms,
        imageLabel,
        featured,
        status,
        gameIds,
        blocks: check.blocks,
      });
      if (!result.ok) {
        setNotice({ ok: false, text: result.error, field: result.field });
        return;
      }
      setNotice({ ok: true, text: status === "published" ? "Salva e publicada." : "Salva." });
      if (!article) router.replace(`/admin/noticias/${result.id}`);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className={LABEL}>
            Título
          </label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            maxLength={200}
            required
            aria-invalid={invalid("title")}
            className={`${INPUT} h-12 text-[19px] font-bold`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-subtitle`} className={LABEL}>
            Linha fina <span className="font-normal text-dim">(opcional)</span>
          </label>
          <textarea
            id={`${id}-subtitle`}
            rows={2}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            maxLength={300}
            aria-invalid={invalid("subtitle")}
            className={TEXTAREA}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-excerpt`} className={LABEL}>
            Resumo para cards e buscadores <span className="font-normal text-dim">(opcional)</span>
          </label>
          <textarea
            id={`${id}-excerpt`}
            rows={2}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            maxLength={300}
            aria-describedby={`${id}-excerpt-hint`}
            aria-invalid={invalid("excerpt")}
            className={TEXTAREA}
          />
          <span id={`${id}-excerpt-hint`} className={HINT}>
            Sem resumo, usamos a linha fina ou o primeiro parágrafo.
          </span>
        </div>
        {article?.legacyBody ? (
          <p className="rounded-[2px] border border-rarity-lendario/50 px-4 py-3 text-[14px] text-text-2">
            Esta notícia ainda usa o corpo antigo em Markdown. Ao salvar com blocos, eles passam a ser o conteúdo exibido.
          </p>
        ) : null}
        <BlockEditor label="Conteúdo" value={drafts} onChange={setDrafts} hint="Os blocos são o texto da notícia, na ordem." />
      </div>

      <div className="flex flex-col gap-5 min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:self-start">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-status`} className={LABEL}>
            Status
          </label>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ArticleStatus)}
            aria-describedby={`${id}-status-hint`}
            className={SELECT}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span id={`${id}-status-hint`} className={HINT}>
            {STATUS_OPTIONS.find((o) => o.value === status)?.hint}
            {article?.source === "bot" && status === "published" && !article.reviewedAt
              ? " Ao publicar, a notícia ganha o selo “revisado pela redação”."
              : ""}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-slug`} className={LABEL}>
            Endereço
          </label>
          <div className="flex items-center rounded-[2px] border border-line-2 bg-bg focus-within:border-text">
            <span className="pl-3 font-mono text-[12px] text-dim">/noticias/</span>
            <input
              id={`${id}-slug`}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              readOnly={slugLocked}
              spellCheck={false}
              aria-describedby={`${id}-slug-hint`}
              aria-invalid={invalid("slug")}
              className="h-11 min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] text-text outline-offset-0 read-only:text-muted"
            />
          </div>
          <span id={`${id}-slug-hint`} className={HINT}>
            {slugLocked ? "Já foi publicada: o endereço não muda mais." : "Letras minúsculas, números e hífens."}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-category`} className={LABEL}>
              Categoria
            </label>
            <select id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT}>
              {ARTICLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-featured`} className={LABEL}>
              Posição
            </label>
            <select id={`${id}-featured`} value={featured} onChange={(e) => setFeatured(Number(e.target.value))} className={SELECT}>
              {FEATURED_LABEL.map((label, value) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${LABEL} mb-1.5`}>Plataformas</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {ARTICLE_PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={platforms.includes(p)}
                  onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))}
                  className="size-4 accent-(--acc)"
                />
                {PLATFORM_LABEL[p]}
              </label>
            ))}
          </div>
        </fieldset>

        <GamePicker games={games} value={gameIds} onChange={setGameIds} invalid={Boolean(invalid("gameIds"))} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-label`} className={LABEL}>
            Rótulo da arte <span className="font-normal text-dim">(opcional)</span>
          </label>
          <input
            id={`${id}-label`}
            value={imageLabel}
            onChange={(e) => setImageLabel(e.target.value)}
            maxLength={60}
            aria-describedby={`${id}-label-hint`}
            aria-invalid={invalid("imageLabel")}
            className={INPUT}
          />
          <span id={`${id}-label-hint`} className={HINT}>
            Texto curto na capa gerada quando não há imagem.
          </span>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : article ? "Salvar alterações" : "Criar notícia"}
          </Button>
          <p aria-live="polite" className="min-h-5 text-[14px]">
            {notice ? (
              <span role={notice.ok ? undefined : "alert"} className={notice.ok ? "text-acc" : "text-nin"}>
                {notice.text}
              </span>
            ) : null}
          </p>
          {article && article.status === "published" ? (
            <Link href={`/noticias/${article.slug}`} className="text-[14px] text-acc underline underline-offset-4 hover:no-underline">
              Ver no site
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}
