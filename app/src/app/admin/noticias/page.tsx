import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminHead, Empty, FilterLinks, param, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { Pager, pageParam } from "@/components/community/Pager";
import { ARTICLE_STATUSES, ARTICLE_STATUS_LABEL, listAdminArticles, type ArticleStatus } from "@/lib/admin/articles";
import { requireStaffPage } from "@/lib/admin/guard";
import { setArticleStatusAction } from "./actions";

export const metadata: Metadata = { title: "Notícias" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function AdminArticlesPage({ searchParams }: PageProps<"/admin/noticias">) {
  await requireStaffPage();
  const sp = await searchParams;
  const rawStatus = param(sp.status);
  const status = (ARTICLE_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as ArticleStatus) : null;
  const rawSource = param(sp.origem);
  const source = rawSource === "bot" || rawSource === "editorial" ? rawSource : null;
  const q = param(sp.q)?.trim().slice(0, 100) || null;
  const { rows, total, page, pageCount } = await listAdminArticles({ status, source, q, page: pageParam(sp.pagina) });

  const href = (next: { status?: string | null; origem?: string | null; pagina?: number }) => {
    const params = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const o = next.origem === undefined ? source : next.origem;
    if (s) params.set("status", s);
    if (o) params.set("origem", o);
    if (q) params.set("q", q);
    if (next.pagina && next.pagina > 1) params.set("pagina", String(next.pagina));
    const query = params.toString();
    return `/admin/noticias${query ? `?${query}` : ""}`;
  };

  return (
    <>
      <AdminHead
        title="Notícias"
        lede={`${total} ${total === 1 ? "notícia" : "notícias"}${status ? ` ${ARTICLE_STATUS_LABEL[status].toLowerCase()}` : ""}.`}
        actions={
          <Link
            href="/admin/noticias/nova"
            className="inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
          >
            Nova notícia
          </Link>
        }
      />
      <div className="flex flex-col gap-3">
        <FilterLinks
          label="Filtrar por status"
          options={[
            { href: href({ status: null }), label: "Todas", current: !status },
            ...ARTICLE_STATUSES.map((s) => ({ href: href({ status: s }), label: ARTICLE_STATUS_LABEL[s], current: status === s })),
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterLinks
            label="Filtrar por origem"
            options={[
              { href: href({ origem: null }), label: "Todas as origens", current: !source },
              { href: href({ origem: "editorial" }), label: "Redação", current: source === "editorial" },
              { href: href({ origem: "bot" }), label: "Robôs", current: source === "bot" },
            ]}
          />
          <form action="/admin/noticias" className="flex gap-2" role="search" aria-label="Buscar notícias">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            {source ? <input type="hidden" name="origem" value={source} /> : null}
            <label htmlFor="busca-noticias" className="sr-only">
              Buscar por título
            </label>
            <input
              id="busca-noticias"
              name="q"
              type="search"
              defaultValue={q ?? ""}
              placeholder="Buscar por título…"
              className="h-9 w-[220px] rounded-[2px] border border-line-2 bg-bg px-3 text-[14px] focus:border-text"
            />
          </form>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nenhuma notícia aqui.">Troque o filtro ou crie uma notícia nova.</Empty>
      ) : (
        <TableRegion label="Notícias">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Título</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Autoria</th>
                <th scope="col" className={TH}>Atualizada</th>
                <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-hover">
                  <td className={`${TD} max-w-[460px]`}>
                    <Link href={`/admin/noticias/${a.id}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                      {a.title}
                    </Link>
                    <div className="font-mono text-xs text-dim">/noticias/{a.slug}</div>
                  </td>
                  <td className={TD}>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className={TD}>
                    <span className="flex flex-col items-start gap-1">
                      {a.source === "bot" ? <StatusBadge status="bot" label={`Robô ${a.botKeyName ?? ""}`.trim()} /> : null}
                      <span className="text-[13px] text-text-3">{a.source === "bot" ? a.author : `@${a.author}`}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <When date={a.updatedAt} />
                  </td>
                  <td className={`${TD} text-right`}>
                    {a.status === "review" ? (
                      <ActionButton
                        action={setArticleStatusAction}
                        input={{ id: a.id, status: "published" }}
                        label="Publicar"
                        ariaLabel={`Publicar "${a.title}"`}
                        tone="primary"
                      />
                    ) : a.status === "published" ? (
                      <ActionButton
                        action={setArticleStatusAction}
                        input={{ id: a.id, status: "archived" }}
                        label="Arquivar"
                        ariaLabel={`Arquivar "${a.title}"`}
                        confirm={`Tirar "${a.title}" do ar?`}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <Pager page={page} pageCount={pageCount} href={(p) => href({ pagina: p })} label="Páginas de notícias" />
    </>
  );
}
