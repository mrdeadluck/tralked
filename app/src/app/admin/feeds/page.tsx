import type { Metadata } from "next";
import { ActionButton } from "@/components/admin/ActionButton";
import { FeedForm } from "@/components/admin/FeedForm";
import { AdminHead, AdminSection, Empty, StatusBadge } from "@/components/admin/ui";
import { listFeeds } from "@/lib/admin/catalog";
import { requireStaffPage } from "@/lib/admin/guard";
import { deleteFeedAction, saveFeedAction, syncNewsAction } from "./actions";

export const metadata: Metadata = { title: "Feeds" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

export default async function FeedsPage() {
  await requireStaffPage("admin");
  const feeds = await listFeeds();

  return (
    <>
      <AdminHead
        title="Feeds"
        lede="Feeds RSS de publicações de games. As manchetes que citam um jogo do catálogo (pelo nome ou nome alternativo) aparecem na página do jogo."
        actions={<ActionButton action={syncNewsAction} input={{}} label="Ler feeds agora" done="Lendo em segundo plano." />}
      />
      <AdminSection title="Novo feed">
        <FeedForm />
      </AdminSection>
      <AdminSection title="Feeds cadastrados" aside={`${feeds.filter((f) => f.active).length} ${feeds.filter((f) => f.active).length === 1 ? "ativo" : "ativos"}`}>
        {feeds.length === 0 ? (
          <Empty title="Nenhum feed cadastrado.">Sem feeds, as páginas de jogo não mostram notícias externas.</Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {feeds.map((feed) => (
              <li key={feed.id} className="flex flex-col gap-3 border-b border-line py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold">{feed.name}</span>
                      <StatusBadge status={feed.active ? "active" : "draft"} label={feed.active ? "Ativo" : "Pausado"} />
                    </span>
                    <code className="font-mono text-[12px] break-all text-text-3">{feed.url}</code>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <ActionButton
                      action={saveFeedAction}
                      input={{ id: feed.id, name: feed.name, url: feed.url, active: !feed.active }}
                      label={feed.active ? "Pausar" : "Ativar"}
                      ariaLabel={`${feed.active ? "Pausar" : "Ativar"} o feed ${feed.name}`}
                    />
                    <ActionButton
                      action={deleteFeedAction}
                      input={{ id: feed.id }}
                      label="Excluir"
                      ariaLabel={`Excluir o feed ${feed.name}`}
                      confirm={`Excluir o feed "${feed.name}"? As manchetes já lidas continuam.`}
                      tone="danger"
                    />
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase hover:text-text">
                    Editar
                  </summary>
                  <div className="pt-3">
                    <FeedForm feed={feed} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  );
}
