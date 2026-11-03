import type { Metadata } from "next";
import Link from "next/link";
import { AdminHead, AdminSection } from "@/components/admin/ui";
import { adminQueues } from "@/lib/admin/dashboard";
import { requireStaffPage } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Painel" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

type Row = { href: string; label: string; count: number; detail: string; adminOnly?: boolean };

export default async function AdminDashboard() {
  const user = await requireStaffPage();
  const q = await adminQueues();
  const admin = user.role === "admin";

  const rows: Row[] = [
    {
      href: "/admin/revisao",
      label: "Notícias em revisão",
      count: q.articlesInReview,
      detail: q.botArticlesInReview > 0 ? `${q.botArticlesInReview} enviadas por robôs` : "Nenhuma de robô",
    },
    { href: "/admin/revisao", label: "Guias em revisão", count: q.guidesInReview, detail: "Publicar ou devolver para rascunho" },
    { href: "/admin/guias/pedidos", label: "Pedidos de guia abertos", count: q.guideRequestsOpen, detail: "Na fila, em andamento ou aguardando fontes" },
    { href: "/admin/moderacao", label: "Denúncias abertas", count: q.openReports, detail: "Comentários, fotos e fórum" },
    { href: "/admin/noticias?status=draft", label: "Rascunhos", count: q.drafts, detail: "Notícias ainda não enviadas" },
    { href: "/admin/fraude", label: "Casos de fraude", count: q.fraudUsers, detail: "Jogadores com desbloqueios suspeitos", adminOnly: true },
    {
      href: "/admin/robos",
      label: "Recusas da API (24 h)",
      count: q.rejectedLastDay,
      detail: `${q.activeKeys} ${q.activeKeys === 1 ? "chave ativa" : "chaves ativas"}`,
      adminOnly: true,
    },
  ];

  return (
    <>
      <AdminHead
        title="Painel"
        lede="O que está esperando a redação agora."
        actions={
          <Link
            href="/admin/noticias/nova"
            className="inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
          >
            Nova notícia
          </Link>
        }
      />
      <AdminSection title="Fila de trabalho">
        <ul className="m-0 flex list-none flex-col p-0">
          {rows
            .filter((row) => admin || !row.adminOnly)
            .map((row) => (
              <li key={row.label} className="border-b border-line">
                <Link
                  href={row.href}
                  className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 px-2 py-3.5 hover:bg-hover"
                >
                  <span
                    className={`font-mono text-[26px] leading-none font-bold tabular-nums ${row.count > 0 ? "text-acc" : "text-dim"}`}
                  >
                    {row.count}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-semibold">{row.label}</span>
                    <span className="text-[13px] text-muted">{row.detail}</span>
                  </span>
                  <span aria-hidden="true" className="font-mono text-[12px] text-dim">
                    Abrir →
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      </AdminSection>
    </>
  );
}
