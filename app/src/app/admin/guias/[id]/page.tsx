import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/admin/ActionButton";
import { GuideEditor } from "@/components/admin/GuideEditor";
import { GuideReportPanel } from "@/components/admin/GuideReportPanel";
import { AdminHead, AdminSection, StatusBadge, When } from "@/components/admin/ui";
import { requireStaffPage } from "@/lib/admin/guard";
import { getGuideForEdit } from "@/lib/admin/guides";
import { applyPendingUpdateAction, discardPendingUpdateAction } from "../actions";

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
      {guide.pending.length > 0 ? (
        <AdminSection title="Atualização esperando aprovação" aside="O guia no ar não muda até você aplicar">
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {guide.pending.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 border border-line-2 p-4">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                  <When date={p.createdAt} />
                  <span className="text-text-3">{p.botKeyName ? `Robô ${p.botKeyName}` : "Robô"}</span>
                </span>
                {p.changes.length > 0 ? (
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px]">
                    {p.changes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <span className="flex flex-wrap gap-2">
                  <ActionButton
                    action={applyPendingUpdateAction}
                    input={{ id: p.id }}
                    label="Aplicar"
                    tone="primary"
                    confirm="Aplicar esta atualização muda o guia publicado. Continuar?"
                  />
                  <ActionButton
                    action={discardPendingUpdateAction}
                    input={{ id: p.id }}
                    label="Descartar"
                    tone="danger"
                    confirm="Descartar esta atualização?"
                  />
                </span>
              </li>
            ))}
          </ul>
        </AdminSection>
      ) : null}
      {guide.report ? <GuideReportPanel report={guide.report} /> : null}
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
