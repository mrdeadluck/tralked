import type { Metadata } from "next";
import { ActionButton } from "@/components/admin/ActionButton";
import { FeedForm } from "@/components/admin/FeedForm";
import { AdminHead, AdminSection, Empty, StatusBadge } from "@/components/admin/ui";
import { listFeeds } from "@/lib/admin/catalog";
import { requireStaffPage } from "@/lib/admin/guard";
import { NEWS_FEED_AREA_HINT, NEWS_FEED_AREA_LABEL, NEWS_FEED_AREAS, toNewsFeedArea } from "@/lib/news/areas";
import { deleteFeedAction, saveFeedAction, syncNewsAction } from "./actions";

export const metadata: Metadata = { title: "Feeds" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const EMPTY_AREA: Record<(typeof NEWS_FEED_AREAS)[number], string> = {
  GAMES: "Sem feeds de games, as páginas de jogo não mostram notícias externas.",
  ENTRETENIMENTO: "Sem feeds de entretenimento, a aba Entretenimento mostra só as matérias do Tralked.",
  TECNOLOGIA: "Sem feeds de tecnologia, a aba Tecnologia mostra só as matérias do Tralked.",
};

export default async function FeedsPage() {
  await requireStaffPage("admin");
  const feeds = await listFeeds();

  return (
    <>
      <AdminHead
        title="Feeds"
        lede="Feeds RSS por área. Games: as manchetes que citam um jogo do catálogo (pelo nome ou nome alternativo) aparecem na página do jogo. Entretenimento e Tecnologia: só o que tem ligação com games (e, em Tecnologia, hardware e IA) entra nas abas dessas categorias, marcado como fonte externa."
        actions={<ActionButton action={syncNewsAction} input={{}} label="Ler feeds agora" done="Lendo em segundo plano." />}
      />
      <AdminSection title="Novo feed">
        <FeedForm />
      </AdminSection>
      {NEWS_FEED_AREAS.map((area) => {
        const list = feeds.filter((f) => toNewsFeedArea(f.area) === area);
        const active = list.filter((f) => f.active).length;
        return (
          <AdminSection
            key={area}
            title={`Feeds: ${NEWS_FEED_AREA_LABEL[area]}`}
            aside={`${list.length} ${list.length === 1 ? "feed" : "feeds"} · ${active} ${active === 1 ? "ativo" : "ativos"}`}
          >
            <p className="max-w-[72ch] text-[14px] text-muted">{NEWS_FEED_AREA_HINT[area]}</p>
            {list.length === 0 ? (
              <Empty title="Nenhum feed nesta área.">{EMPTY_AREA[area]}</Empty>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {list.map((feed) => (
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
                          input={{ id: feed.id, name: feed.name, url: feed.url, area, active: !feed.active }}
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
        );
      })}
    </>
  );
}
