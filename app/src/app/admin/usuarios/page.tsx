import type { Metadata } from "next";
import Link from "next/link";
import { RoleSelect } from "@/components/admin/RoleSelect";
import { AdminHead, Empty, FilterLinks, param, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { Pager, pageParam } from "@/components/community/Pager";
import { requireStaffPage } from "@/lib/admin/guard";
import { listUsers, ROLE_LABEL, ROLES, type Role } from "@/lib/admin/users";

export const metadata: Metadata = { title: "Usuários" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function UsersPage({ searchParams }: PageProps<"/admin/usuarios">) {
  const me = await requireStaffPage("admin");
  const sp = await searchParams;
  const rawRole = param(sp.papel);
  const role = (ROLES as readonly string[]).includes(rawRole ?? "") ? (rawRole as Role) : null;
  const q = param(sp.q)?.trim().slice(0, 100) || null;
  const { rows, total, page, pageCount } = await listUsers({ q, role, page: pageParam(sp.pagina) });
  const href = (next: { papel?: Role | null; pagina?: number }) => {
    const params = new URLSearchParams();
    const r = next.papel === undefined ? role : next.papel;
    if (r) params.set("papel", r);
    if (q) params.set("q", q);
    if (next.pagina && next.pagina > 1) params.set("pagina", String(next.pagina));
    const s = params.toString();
    return `/admin/usuarios${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <AdminHead
        title="Usuários"
        lede="Editores cuidam de conteúdo e moderação; admins também de robôs, feeds, jogos, fraude e papéis. Ninguém muda o próprio papel."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterLinks
          label="Filtrar por papel"
          options={[
            { href: href({ papel: null }), label: "Todos", current: !role },
            ...ROLES.map((r) => ({ href: href({ papel: r }), label: ROLE_LABEL[r], current: role === r })),
          ]}
        />
        <form action="/admin/usuarios" className="flex gap-2" role="search" aria-label="Buscar usuários">
          {role ? <input type="hidden" name="papel" value={role} /> : null}
          <label htmlFor="busca-usuarios" className="sr-only">
            Buscar usuário
          </label>
          <input
            id="busca-usuarios"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Buscar por @ ou nome…"
            className="h-9 w-[220px] rounded-[2px] border border-line-2 bg-bg px-3 text-[14px] focus:border-text"
          />
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nenhum usuário encontrado." />
      ) : (
        <TableRegion label="Usuários">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Usuário</th>
                <th scope="col" className={TH}>Nível</th>
                <th scope="col" className={TH}>Entrou</th>
                <th scope="col" className={TH}>Papel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-hover">
                  <td className={TD}>
                    <Link href={`/jogador/${u.handle}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                      {u.displayName}
                    </Link>
                    <span className="block font-mono text-[12px] text-dim">@{u.handle}</span>
                  </td>
                  <td className={`${TD} font-mono text-[14px] tabular-nums`}>{u.level ?? "—"}</td>
                  <td className={TD}>
                    <When date={u.createdAt} />
                  </td>
                  <td className={TD}>
                    {u.id === me.id ? (
                      <span className="flex items-center gap-2">
                        <StatusBadge status="active" label={ROLE_LABEL[u.role as Role] ?? u.role} />
                        <span className="text-[12px] text-dim">você</span>
                      </span>
                    ) : (
                      <RoleSelect userId={u.id} handle={u.handle} role={u.role} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <p className="font-mono text-[11px] text-dim">{total} usuários</p>
      <Pager page={page} pageCount={pageCount} href={(p) => href({ pagina: p })} label="Páginas de usuários" />
    </>
  );
}
