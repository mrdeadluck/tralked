import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminHead, Empty, FilterLinks, param, StatusBadge, TabLinks, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { Pager, pageParam } from "@/components/community/Pager";
import { requireStaffPage } from "@/lib/admin/guard";
import {
  CONTENT_FILTERS,
  listContent,
  listReports,
  REPORT_STATUSES,
  type ContentFilter,
  type ModerationTarget,
  type ReportStatus,
} from "@/lib/admin/moderation";
import { decideReportAction, moderateAction } from "./actions";

export const metadata: Metadata = { title: "Moderação" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const TABS = [
  { id: "denuncias", label: "Denúncias" },
  { id: "comentarios", label: "Comentários", type: "comment" },
  { id: "forum", label: "Fórum: respostas", type: "post" },
  { id: "topicos", label: "Fórum: tópicos", type: "thread" },
  { id: "fotos", label: "Fotos", type: "photo" },
] as const;

const REPORT_LABEL: Record<ReportStatus, string> = { open: "Abertas", resolved: "Resolvidas", dismissed: "Descartadas" };
const FILTER_LABEL: Record<ContentFilter, string> = { all: "Ativos", visible: "Visíveis", hidden: "Ocultos", removed: "Removidos" };
const TARGET_LABEL: Record<string, string> = {
  comment: "Comentário",
  post: "Resposta no fórum",
  thread: "Tópico",
  photo: "Foto",
  article: "Notícia",
  guide: "Guia",
  user: "Perfil",
  message: "Mensagem privada",
};

export default async function ModerationPage({ searchParams }: PageProps<"/admin/moderacao">) {
  await requireStaffPage();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === param(sp.aba)) ?? TABS[0];
  const page = pageParam(sp.pagina);

  return (
    <>
      <AdminHead
        title="Moderação"
        lede="Ocultar é reversível e mantém o XP. Remover é definitivo e anula o XP que o conteúdo rendeu (fotos e respostas que resolveram tópicos)."
      />
      <TabLinks
        label="Tipo de conteúdo"
        options={TABS.map((t) => ({ href: `/admin/moderacao?aba=${t.id}`, label: t.label, current: t.id === tab.id }))}
      />
      {"type" in tab ? (
        <ContentList type={tab.type} tabId={tab.id} filterParam={param(sp.status)} page={page} />
      ) : (
        <Reports statusParam={param(sp.status)} page={page} />
      )}
    </>
  );
}

async function Reports({ statusParam, page }: { statusParam: string | undefined; page: number }) {
  const status: ReportStatus = (REPORT_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as ReportStatus)
    : "open";
  const { reports, page: current, pageCount } = await listReports(status, page);
  const href = (s: ReportStatus, p = 1) => `/admin/moderacao?aba=denuncias&status=${s}${p > 1 ? `&pagina=${p}` : ""}`;

  return (
    <>
      <FilterLinks
        label="Status das denúncias"
        options={REPORT_STATUSES.map((s) => ({ href: href(s), label: REPORT_LABEL[s], current: s === status }))}
      />
      {reports.length === 0 ? (
        <Empty title={status === "open" ? "Nenhuma denúncia aberta." : "Nada por aqui."}>
          {status === "open" ? "Quando alguém denunciar um conteúdo, ele aparece aqui." : null}
        </Empty>
      ) : (
        <TableRegion label="Denúncias">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Conteúdo</th>
                <th scope="col" className={TH}>Motivo</th>
                <th scope="col" className={TH}>Quando</th>
                <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-hover">
                  <td className={`${TD} max-w-[440px]`}>
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase">
                        {TARGET_LABEL[r.targetType] ?? r.targetType}
                      </span>
                      {r.target?.status ? <StatusBadge status={r.target.status} /> : null}
                    </span>
                    {r.target ? (
                      <>
                        <p className="line-clamp-3 text-[14px] break-words whitespace-pre-line">{r.target.text}</p>
                        <span className="mt-1 flex flex-wrap gap-3 text-[13px] text-text-3">
                          {r.target.author ? <span>@{r.target.author}</span> : null}
                          {r.target.href ? (
                            <Link href={r.target.href} className="text-acc underline underline-offset-4 hover:no-underline">
                              Abrir
                            </Link>
                          ) : null}
                          {r.target.editHref ? (
                            <Link href={r.target.editHref} className="text-acc underline underline-offset-4 hover:no-underline">
                              Editar
                            </Link>
                          ) : null}
                        </span>
                      </>
                    ) : (
                      <p className="text-[14px] text-muted">Esse conteúdo não existe mais.</p>
                    )}
                  </td>
                  <td className={`${TD} max-w-[260px]`}>
                    <p className="text-[14px] break-words">{r.reason}</p>
                    <span className="text-[12px] text-dim">por {r.reporter ? `@${r.reporter}` : "conta removida"}</span>
                  </td>
                  <td className={TD}>
                    <When date={r.createdAt} />
                    {r.resolvedAt ? (
                      <span className="block text-[12px] text-dim">
                        Encerrada por {r.resolvedBy ? `@${r.resolvedBy}` : "—"}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {r.status === "open" ? (
                      <span className="flex flex-wrap justify-end gap-2">
                        {r.target?.moderatable && r.target.status !== "removed" ? (
                          <>
                            {r.target.status !== "hidden" && r.target.status !== "deleted" ? (
                              <ActionButton
                                action={moderateAction}
                                input={{ targetType: r.target.moderatable, targetId: r.targetId, action: "hide" }}
                                label="Ocultar"
                                ariaLabel={`Ocultar ${TARGET_LABEL[r.targetType]?.toLowerCase() ?? "conteúdo"} denunciado`}
                              />
                            ) : null}
                            {r.target.status !== "deleted" ? (
                              <ActionButton
                                action={moderateAction}
                                input={{ targetType: r.target.moderatable, targetId: r.targetId, action: "remove" }}
                                label="Remover"
                                ariaLabel={`Remover ${TARGET_LABEL[r.targetType]?.toLowerCase() ?? "conteúdo"} denunciado`}
                                confirm="Remover de vez? O XP que esse conteúdo rendeu é anulado."
                                tone="danger"
                              />
                            ) : null}
                          </>
                        ) : null}
                        <ActionButton
                          action={decideReportAction}
                          input={{ reportId: r.id, decision: "resolved" }}
                          label="Resolver"
                          ariaLabel="Resolver denúncia"
                        />
                        <ActionButton
                          action={decideReportAction}
                          input={{ reportId: r.id, decision: "dismissed" }}
                          label="Descartar"
                          ariaLabel="Descartar denúncia"
                        />
                      </span>
                    ) : (
                      <StatusBadge status={r.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <Pager page={current} pageCount={pageCount} href={(p) => href(status, p)} label="Páginas de denúncias" />
    </>
  );
}

async function ContentList({
  type,
  tabId,
  filterParam,
  page,
}: {
  type: ModerationTarget;
  tabId: string;
  filterParam: string | undefined;
  page: number;
}) {
  const filter: ContentFilter = (CONTENT_FILTERS as readonly string[]).includes(filterParam ?? "")
    ? (filterParam as ContentFilter)
    : "all";
  const { rows, total, page: current, pageCount } = await listContent(type, filter, page);
  const href = (f: ContentFilter, p = 1) => `/admin/moderacao?aba=${tabId}&status=${f}${p > 1 ? `&pagina=${p}` : ""}`;
  const noun = TARGET_LABEL[type].toLowerCase();

  return (
    <>
      <FilterLinks
        label="Status"
        options={CONTENT_FILTERS.map((f) => ({ href: href(f), label: FILTER_LABEL[f], current: f === filter, count: f === filter ? total : undefined }))}
      />
      {rows.length === 0 ? (
        <Empty title="Nada por aqui." />
      ) : (
        <TableRegion label={TABS.find((t) => t.id === tabId)?.label ?? "Conteúdo"}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Conteúdo</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Quando</th>
                <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const who = row.author ? ` de @${row.author}` : "";
                return (
                  <tr key={row.id} className="hover:bg-hover">
                    <td className={`${TD} max-w-[520px]`}>
                      <p className="line-clamp-3 text-[14px] break-words whitespace-pre-line">{row.text || "(vazio)"}</p>
                      <span className="mt-1 flex flex-wrap gap-3 text-[13px] text-text-3">
                        <span>{row.author ? `@${row.author}` : "conta removida"}</span>
                        {row.reports > 0 ? (
                          <span className="text-rarity-lendario">
                            {row.reports} {row.reports === 1 ? "denúncia aberta" : "denúncias abertas"}
                          </span>
                        ) : null}
                        {row.href && row.status !== "removed" ? (
                          <Link href={row.href} className="text-acc underline underline-offset-4 hover:no-underline">
                            Abrir
                          </Link>
                        ) : null}
                      </span>
                    </td>
                    <td className={TD}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className={TD}>
                      <When date={row.createdAt} />
                    </td>
                    <td className={TD}>
                      {row.status === "removed" ? null : (
                        <span className="flex flex-wrap justify-end gap-2">
                          {row.status === "hidden" ? (
                            <ActionButton
                              action={moderateAction}
                              input={{ targetType: type, targetId: row.id, action: "restore" }}
                              label="Restaurar"
                              ariaLabel={`Restaurar ${noun}${who}`}
                            />
                          ) : (
                            <ActionButton
                              action={moderateAction}
                              input={{ targetType: type, targetId: row.id, action: "hide" }}
                              label="Ocultar"
                              ariaLabel={`Ocultar ${noun}${who}`}
                            />
                          )}
                          {type === "thread" && row.status === "open" ? (
                            <ActionButton
                              action={moderateAction}
                              input={{ targetType: type, targetId: row.id, action: "lock" }}
                              label="Trancar"
                              ariaLabel={`Trancar ${noun}${who}`}
                            />
                          ) : null}
                          {type === "thread" && row.status === "locked" ? (
                            <ActionButton
                              action={moderateAction}
                              input={{ targetType: type, targetId: row.id, action: "unlock" }}
                              label="Destrancar"
                              ariaLabel={`Destrancar ${noun}${who}`}
                            />
                          ) : null}
                          <ActionButton
                            action={moderateAction}
                            input={{ targetType: type, targetId: row.id, action: "remove" }}
                            label="Remover"
                            ariaLabel={`Remover ${noun}${who}`}
                            confirm="Remover de vez? O XP que esse conteúdo rendeu é anulado."
                            tone="danger"
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      )}
      <Pager page={current} pageCount={pageCount} href={(p) => href(filter, p)} label="Páginas" />
    </>
  );
}
