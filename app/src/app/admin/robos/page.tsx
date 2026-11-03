import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { KeyCreator } from "@/components/admin/KeyCreator";
import { AdminHead, AdminSection, Empty, FILTER_SELECT, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { Pager } from "@/components/community/Pager";
import { requireStaffPage } from "@/lib/admin/guard";
import {
  INGESTION_KIND_FILTER_LABEL,
  INGESTION_KINDS,
  INGESTION_STATUSES,
  ingestionFilterSchema,
  ingestionKindView,
  listIngestion,
} from "@/lib/admin/robots";
import { listApiKeys } from "@/lib/api/keys";
import { revokeKeyAction } from "./actions";

export const metadata: Metadata = { title: "Robôs" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const STATUS_LABEL = { created: "Criados", updated: "Atualizados", rejected: "Recusados" } as const;
const activeLabel = (n: number) => `${n} ${n === 1 ? "ativa" : "ativas"}`;

export default async function RobotsPage({ searchParams }: PageProps<"/admin/robos">) {
  await requireStaffPage("admin");
  const sp = await searchParams;
  const filter = ingestionFilterSchema.parse({
    key: typeof sp.chave === "string" && sp.chave ? sp.chave : undefined,
    status: typeof sp.status === "string" && sp.status ? sp.status : undefined,
    kind: typeof sp.tipo === "string" && sp.tipo ? sp.tipo : undefined,
    page: typeof sp.pagina === "string" ? sp.pagina : 1,
  });
  const [keys, log] = await Promise.all([listApiKeys(), listIngestion(filter)]);
  const keyName = new Map(keys.map((k) => [k.id, k.name]));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (filter.key) params.set("chave", filter.key);
    if (filter.status) params.set("status", filter.status);
    if (filter.kind) params.set("tipo", filter.kind);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return `/admin/robos${s ? `?${s}` : ""}#log`;
  };

  return (
    <>
      <AdminHead
        title="Robôs"
        lede={
          <>
            Chaves da API de ingestão. Sem o escopo publish, o conteúdo entra na{" "}
            <Link href="/admin/revisao" className="text-acc underline underline-offset-4 hover:no-underline">
              fila de revisão
            </Link>
            . Documentação em{" "}
            <Link href="/desenvolvedores" className="text-acc underline underline-offset-4 hover:no-underline">
              /desenvolvedores
            </Link>
            .
          </>
        }
      />

      <AdminSection title="Nova chave">
        <KeyCreator />
      </AdminSection>

      <AdminSection title="Chaves" aside={activeLabel(keys.filter((k) => !k.revokedAt).length)}>
        {keys.length === 0 ? (
          <Empty title="Nenhuma chave criada." />
        ) : (
          <TableRegion label="Chaves de API">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Robô</th>
                  <th scope="col" className={TH}>Escopos</th>
                  <th scope="col" className={TH}>Criada</th>
                  <th scope="col" className={TH}>Último uso</th>
                  <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "text-dim" : "hover:bg-hover"}>
                    <td className={TD}>
                      <span className="font-semibold">{k.name}</span>
                      <code className="block font-mono text-[12px] text-dim">{k.prefix}…</code>
                    </td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <code key={s} className="rounded-[2px] border border-line-2 px-1.5 py-0.5 font-mono text-xs">
                            {s}
                          </code>
                        ))}
                      </span>
                    </td>
                    <td className={TD}>
                      <When date={k.createdAt} />
                    </td>
                    <td className={TD}>
                      <When date={k.lastUsedAt} />
                    </td>
                    <td className={`${TD} text-right`}>
                      {k.revokedAt ? (
                        <span className="flex flex-col items-end gap-1">
                          <StatusBadge status="revoked" />
                          <When date={k.revokedAt} />
                        </span>
                      ) : (
                        <ActionButton
                          action={revokeKeyAction}
                          input={{ id: k.id }}
                          label="Revogar"
                          ariaLabel={`Revogar a chave ${k.name}`}
                          confirm={`Revogar a chave "${k.name}"? O robô perde o acesso na hora.`}
                          tone="danger"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </AdminSection>

      <section id="log" className="flex scroll-mt-6 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-2">
          <h2 className="text-[17px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.01em] uppercase">Log de ingestão</h2>
          <span className="font-mono text-xs tracking-[0.06em] text-dim">{log.total} registros</span>
        </div>
        <form action="/admin/robos#log" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="log-chave" className="text-[13px] font-semibold text-text-2">
              Chave
            </label>
            <select id="log-chave" name="chave" defaultValue={filter.key ?? ""} className={`${FILTER_SELECT} w-[200px] max-w-full`}>
              <option value="">Todas</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="log-status" className="text-[13px] font-semibold text-text-2">
              Resultado
            </label>
            <select id="log-status" name="status" defaultValue={filter.status ?? ""} className={`${FILTER_SELECT} w-[160px]`}>
              <option value="">Todos</option>
              {INGESTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="log-tipo" className="text-[13px] font-semibold text-text-2">
              Tipo
            </label>
            <select id="log-tipo" name="tipo" defaultValue={filter.kind ?? ""} className={`${FILTER_SELECT} w-[170px]`}>
              <option value="">Todos</option>
              {INGESTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INGESTION_KIND_FILTER_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex h-9 cursor-pointer items-center rounded-[2px] border border-line-2 px-3 font-mono text-xs font-bold tracking-[0.08em] text-text-2 uppercase hover:border-text hover:text-text"
          >
            Filtrar
          </button>
        </form>
        {log.rows.length === 0 ? (
          <Empty title="Nenhum envio com esses filtros." />
        ) : (
          <TableRegion label="Log de ingestão">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Quando</th>
                  <th scope="col" className={TH}>Robô</th>
                  <th scope="col" className={TH}>Envio</th>
                  <th scope="col" className={TH}>Resultado</th>
                  <th scope="col" className={TH}>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.map((row) => {
                  const kind = ingestionKindView(row.kind, row.resultId);
                  return (
                    <tr key={row.id} className="hover:bg-hover">
                      <td className={TD}>
                        <When date={row.createdAt} />
                      </td>
                      <td className={`${TD} text-[13px]`}>{keyName.get(row.keyId) ?? row.keyName}</td>
                      <td className={TD}>
                        <span className="text-[13px]">{kind.label}</span>
                        <code className="block max-w-[200px] truncate font-mono text-xs text-dim" title={row.idempotencyKey}>
                          {row.idempotencyKey}
                        </code>
                      </td>
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={row.status} />
                          {row.httpStatus ? <span className="font-mono text-[12px] text-dim tabular-nums">{row.httpStatus}</span> : null}
                        </span>
                      </td>
                      <td className={`${TD} max-w-[380px] text-[13px]`}>
                        {row.issues.length > 0 ? (
                          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-text-2">
                            {row.issues.map((issue, i) => (
                              <li key={i} className="break-words">
                                {issue}
                              </li>
                            ))}
                          </ul>
                        ) : kind.href ? (
                          <Link href={kind.href} className="text-acc underline underline-offset-4 hover:no-underline">
                            {row.kind === "guide_request" ? "Abrir os pedidos" : "Abrir no editor"}
                          </Link>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableRegion>
        )}
        <Pager page={log.page} pageCount={log.pageCount} href={pageHref} label="Páginas do log" />
      </section>
    </>
  );
}
