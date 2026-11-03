import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminHead, AdminSection, Empty, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { articlesInReview } from "@/lib/admin/articles";
import { requireStaffPage } from "@/lib/admin/guard";
import { guidesInReview, pendingGuideUpdates } from "@/lib/admin/guides";
import { applyPendingUpdateAction, discardPendingUpdateAction, setGuideStatusAction } from "../guias/actions";
import { setArticleStatusAction } from "../noticias/actions";

export const metadata: Metadata = { title: "Revisão" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

/** Review queue: articles and guides waiting for an editor, bot content first. */
export default async function ReviewQueuePage() {
  await requireStaffPage();
  const [articles, guides, pending] = await Promise.all([articlesInReview(), guidesInReview(), pendingGuideUpdates()]);

  return (
    <>
      <AdminHead
        title="Revisão"
        lede="Conteúdo esperando um editor. O que chega dos robôs sem o escopo publish para aqui: leia, ajuste no editor e publique."
      />
      <AdminSection title="Notícias" aside={`${articles.length} na fila`}>
        {articles.length === 0 ? (
          <Empty title="Nenhuma notícia esperando revisão." />
        ) : (
          <TableRegion label="Notícias em revisão">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Título</th>
                  <th scope="col" className={TH}>Origem</th>
                  <th scope="col" className={TH}>Chegou</th>
                  <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.id} className="hover:bg-hover">
                    <td className={`${TD} max-w-[460px]`}>
                      <Link href={`/admin/noticias/${a.id}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                        {a.title}
                      </Link>
                    </td>
                    <td className={TD}>
                      {a.source === "bot" ? (
                        <StatusBadge status="bot" label={`Robô ${a.botKeyName ?? ""}`.trim()} />
                      ) : (
                        <span className="text-[13px] text-text-3">@{a.author}</span>
                      )}
                    </td>
                    <td className={TD}>
                      <When date={a.publishedAt} />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-wrap justify-end gap-2">
                        <Link
                          href={`/admin/noticias/${a.id}`}
                          className="inline-flex h-9 items-center rounded-[2px] border border-line-2 px-3 font-mono text-xs font-bold tracking-[0.08em] text-text-2 uppercase hover:border-text hover:text-text"
                        >
                          Revisar
                        </Link>
                        <ActionButton
                          action={setArticleStatusAction}
                          input={{ id: a.id, status: "published" }}
                          label="Publicar"
                          ariaLabel={`Publicar "${a.title}"`}
                          tone="primary"
                        />
                        <ActionButton
                          action={setArticleStatusAction}
                          input={{ id: a.id, status: "draft" }}
                          label="Devolver"
                          ariaLabel={`Devolver "${a.title}" para rascunho`}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </AdminSection>

      <AdminSection title="Guias" aside={`${guides.length} na fila`}>
        {guides.length === 0 ? (
          <Empty title="Nenhum guia esperando revisão." />
        ) : (
          <TableRegion label="Guias em revisão">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Jogo</th>
                  <th scope="col" className={TH}>Origem</th>
                  <th scope="col" className={TH}>Atualizado</th>
                  <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {guides.map((g) => (
                  <tr key={g.id} className="hover:bg-hover">
                    <td className={TD}>
                      <Link href={`/admin/guias/${g.id}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                        Guia de {g.gameName}
                      </Link>
                      <span className="block font-mono text-xs text-dim">{g.version}</span>
                      {g.reportLine ? <span className="block text-[13px] text-muted">Relatório do robô: {g.reportLine}</span> : null}
                    </td>
                    <td className={TD}>
                      {g.source === "bot" ? (
                        <StatusBadge status="bot" label={`Robô ${g.botKeyName ?? ""}`.trim()} />
                      ) : (
                        <span className="text-[13px] text-text-3">{g.author ? `@${g.author}` : "Redação"}</span>
                      )}
                    </td>
                    <td className={TD}>
                      <When date={g.updatedAt} />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-wrap justify-end gap-2">
                        <ActionButton
                          action={setGuideStatusAction}
                          input={{ id: g.id, status: "published" }}
                          label="Publicar"
                          ariaLabel={`Publicar o guia de ${g.gameName}`}
                          tone="primary"
                        />
                        <ActionButton
                          action={setGuideStatusAction}
                          input={{ id: g.id, status: "draft" }}
                          label="Devolver"
                          ariaLabel={`Devolver o guia de ${g.gameName} para rascunho`}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </AdminSection>

      <AdminSection title="Atualizações de guias no ar" aside={`${pending.length} esperando`}>
        {pending.length === 0 ? (
          <Empty title="Nenhuma atualização esperando aprovação." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
                <span className="flex flex-col gap-1">
                  <Link href={`/admin/guias/${p.guideId}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                    Guia de {p.gameName}
                  </Link>
                  <span className="flex items-center gap-3 text-[13px] text-text-3">
                    <When date={p.createdAt} />
                    {p.changes.join(" · ")}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <ActionButton
                    action={applyPendingUpdateAction}
                    input={{ id: p.id }}
                    label="Aplicar"
                    ariaLabel={`Aplicar a atualização do guia de ${p.gameName}`}
                    tone="primary"
                    confirm="Aplicar esta atualização muda o guia publicado. Continuar?"
                  />
                  <ActionButton
                    action={discardPendingUpdateAction}
                    input={{ id: p.id }}
                    label="Descartar"
                    ariaLabel={`Descartar a atualização do guia de ${p.gameName}`}
                    confirm="Descartar esta atualização?"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  );
}
