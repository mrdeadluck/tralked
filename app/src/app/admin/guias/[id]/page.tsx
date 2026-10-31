import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideEditor } from "@/components/admin/GuideEditor";
import { AdminHead, AdminSection, StatusBadge, When } from "@/components/admin/ui";
import { requireStaffPage } from "@/lib/admin/guard";
import { getGuideForEdit } from "@/lib/admin/guides";

export const metadata: Metadata = { title: "Editar guia" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function EditGuidePage({ params }: PageProps<"/admin/guias/[id]">) {
  await requireStaffPage();
  const { id } = await params;
  const guide = await getGuideForEdit(id);
  if (!guide) notFound();

  return (
    <>
      <AdminHead
        title={`Guia de ${guide.gameName}`}
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={guide.status} />
            {guide.source === "bot" ? <StatusBadge status="bot" label={`Robô ${guide.botKeyName ?? ""}`.trim()} /> : null}
            <Link href={`/jogos/${guide.gameSlug}/guia`} className="text-acc underline underline-offset-4 hover:no-underline">
              Ver no site
            </Link>
            <Link href="/admin/guias" className="text-acc underline underline-offset-4 hover:no-underline">
              Voltar à lista
            </Link>
          </span>
        }
      />
      <GuideEditor guide={guide} />
      <AdminSection title="Versões salvas" aside="As 10 mais recentes">
        {guide.versions.length === 0 ? (
          <p className="text-[14px] text-muted">Nenhuma versão ainda: a primeira é salva no próximo salvamento.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {guide.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-2 text-[14px]">
                <span className="font-mono font-bold tabular-nums">#{v.version}</span>
                <When date={v.createdAt} />
                <span className="text-text-3">{v.author ? `@${v.author}` : "Robô ou importação"}</span>
              </li>
            ))}
          </ol>
        )}
      </AdminSection>
    </>
  );
}
