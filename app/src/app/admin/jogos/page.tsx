import type { Metadata } from "next";
import Link from "next/link";
import { AdminHead, Empty, param, TableRegion, TABLE, TD, TH } from "@/components/admin/ui";
import { Pager, pageParam } from "@/components/community/Pager";
import { listAdminGames } from "@/lib/admin/catalog";
import { requireStaffPage } from "@/lib/admin/guard";
import { SKILLS } from "@/lib/engine/types";

export const metadata: Metadata = { title: "Jogos" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const SKILL_NAME = new Map(SKILLS.map((s) => [s.id as string, s.name]));

export default async function AdminGamesPage({ searchParams }: PageProps<"/admin/jogos">) {
  await requireStaffPage("admin");
  const sp = await searchParams;
  const q = param(sp.q)?.trim().slice(0, 100) || null;
  const { rows, total, page, pageCount } = await listAdminGames(q, pageParam(sp.pagina));
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return `/admin/jogos${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <AdminHead
        title="Jogos"
        lede={`${total} ${total === 1 ? "jogo" : "jogos"} no catálogo. Ajuste gêneros e nomes alternativos, ou busque mídia de novo.`}
        actions={
          <form action="/admin/jogos" className="flex gap-2" role="search" aria-label="Buscar jogos">
            <label htmlFor="busca-jogos" className="sr-only">
              Buscar jogo
            </label>
            <input
              id="busca-jogos"
              name="q"
              type="search"
              defaultValue={q ?? ""}
              placeholder="Buscar jogo…"
              className="h-11 w-[240px] rounded-[2px] border border-line-2 bg-bg px-3 text-[15px] focus:border-text"
            />
          </form>
        }
      />
      {rows.length === 0 ? (
        <Empty title="Nenhum jogo encontrado." />
      ) : (
        <TableRegion label="Jogos">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Jogo</th>
                <th scope="col" className={TH}>Gêneros</th>
                <th scope="col" className={TH}>Nomes alternativos</th>
                <th scope="col" className={`${TH} text-right`}>Mídias</th>
                <th scope="col" className={`${TH} text-right`}>Notícias ext.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="hover:bg-hover">
                  <td className={TD}>
                    <Link href={`/admin/jogos/${g.id}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                      {g.name}
                    </Link>
                    <span className="block font-mono text-[11px] text-dim">
                      {g.slug}
                      {g.steamAppId ? ` · app ${g.steamAppId}` : ""}
                    </span>
                  </td>
                  <td className={`${TD} text-[13px]`}>
                    {g.skills.length > 0 ? (
                      g.skills.map((s) => SKILL_NAME.get(s) ?? s).join(", ")
                    ) : (
                      <span className="text-rarity-lendario">Sem gênero</span>
                    )}
                  </td>
                  <td className={`${TD} max-w-[280px] text-[13px] text-text-3`}>{g.aliases.join(", ") || "—"}</td>
                  <td className={`${TD} text-right font-mono text-[13px] tabular-nums`}>{g.media}</td>
                  <td className={`${TD} text-right font-mono text-[13px] tabular-nums`}>{g.news}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <Pager page={page} pageCount={pageCount} href={href} label="Páginas de jogos" />
    </>
  );
}
