import type { Metadata } from "next";
import Link from "next/link";
import { AdminHead, Empty, FilterLinks, param, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { requireStaffPage } from "@/lib/admin/guard";
import { GUIDE_STATUSES, GUIDE_STATUS_LABEL, listAdminGuides, type GuideStatus } from "@/lib/admin/guides";

export const metadata: Metadata = { title: "Guias" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function AdminGuidesPage({ searchParams }: PageProps<"/admin/guias">) {
  await requireStaffPage();
  const sp = await searchParams;
  const raw = param(sp.status);
  const status = (GUIDE_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as GuideStatus) : null;
  const q = param(sp.q)?.trim().slice(0, 100) || null;
  const guides = await listAdminGuides({ status, q });

  return (
    <>
      <AdminHead
        title="Guias"
        lede="Um guia por jogo. Cada salvamento guarda uma versão completa para consulta."
        actions={
          <Link
            href="/admin/guias/novo"
            className="inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
          >
            Novo guia
          </Link>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterLinks
          label="Filtrar por status"
          options={[
            { href: "/admin/guias", label: "Todos", current: !status },
            ...GUIDE_STATUSES.map((s) => ({ href: `/admin/guias?status=${s}`, label: GUIDE_STATUS_LABEL[s], current: status === s })),
          ]}
        />
        <form action="/admin/guias" className="flex gap-2" role="search" aria-label="Buscar guias">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <label htmlFor="busca-guias" className="sr-only">
            Buscar por jogo
          </label>
          <input
            id="busca-guias"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Buscar por jogo…"
            className="h-9 w-[220px] rounded-[2px] border border-line-2 bg-bg px-3 text-[14px] focus:border-text"
          />
        </form>
      </div>
      {guides.length === 0 ? (
        <Empty title="Nenhum guia aqui.">Crie um em “Novo guia” ou receba pela API dos robôs.</Empty>
      ) : (
        <TableRegion label="Guias">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Jogo</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Autoria</th>
                <th scope="col" className={TH}>Versão</th>
                <th scope="col" className={TH}>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {guides.map((g) => (
                <tr key={g.id} className="hover:bg-hover">
                  <td className={TD}>
                    <Link href={`/admin/guias/${g.id}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                      {g.gameName}
                    </Link>
                  </td>
                  <td className={TD}>
                    <StatusBadge status={g.status} />
                  </td>
                  <td className={TD}>
                    {g.source === "bot" ? (
                      <StatusBadge status="bot" label={`Robô ${g.botKeyName ?? ""}`.trim()} />
                    ) : (
                      <span className="text-[13px] text-text-3">{g.author ? `@${g.author}` : "Redação"}</span>
                    )}
                  </td>
                  <td className={TD}>
                    <span className="font-mono text-[13px] tabular-nums">{g.version}</span>
                    <span className="block font-mono text-[11px] text-dim">
                      {g.revisions} {g.revisions === 1 ? "revisão salva" : "revisões salvas"}
                    </span>
                  </td>
                  <td className={TD}>
                    <When date={g.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
    </>
  );
}
