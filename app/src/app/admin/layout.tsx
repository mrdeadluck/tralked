import type { Metadata } from "next";
import { AdminNav, type AdminNavItem } from "@/components/admin/AdminNav";
import { adminQueues } from "@/lib/admin/dashboard";
import { requireStaffPage } from "@/lib/admin/guard";
import { ROLE_LABEL, type Role } from "@/lib/admin/roles";

export const metadata: Metadata = {
  title: { default: "Admin · Tralked", template: "%s · Admin · Tralked" },
  robots: { index: false, follow: false },
};

// The role check must finish before anything streams, so non-staff get a real 404 status
// (a check behind a Suspense boundary would answer 200 and stream the not-found page).
export const instant = false;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffPage();
  const queues = await adminQueues();
  const admin = user.role === "admin";

  const items: AdminNavItem[] = [
    { href: "/admin", label: "Painel" },
    { href: "/admin/revisao", label: "Revisão", count: queues.articlesInReview + queues.guidesInReview },
    { href: "/admin/noticias", label: "Notícias" },
    { href: "/admin/guias", label: "Guias" },
    { href: "/admin/moderacao", label: "Moderação", count: queues.openReports },
    ...(admin
      ? [
          { href: "/admin/fraude", label: "Fraude", count: queues.fraudUsers },
          { href: "/admin/jogos", label: "Jogos" },
          { href: "/admin/robos", label: "Robôs" },
          { href: "/admin/feeds", label: "Feeds" },
          { href: "/admin/usuarios", label: "Usuários" },
        ]
      : []),
  ];

  return (
    <div className="grid gap-6 nav:grid-cols-[208px_minmax(0,1fr)] nav:gap-10">
      <aside className="flex min-w-0 flex-col gap-3 nav:sticky nav:top-6 nav:self-start">
        <p className="flex items-center justify-between gap-2 border-b border-line pb-3 font-mono text-xs tracking-[0.08em] text-dim uppercase">
          <span>Redação</span>
          <span className="text-text-3">
            @{user.handle} · {ROLE_LABEL[user.role as Role] ?? user.role}
          </span>
        </p>
        <AdminNav items={items} />
      </aside>
      <div className="flex min-w-0 flex-col gap-8">{children}</div>
    </div>
  );
}
