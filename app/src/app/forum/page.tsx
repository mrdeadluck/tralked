import type { Metadata } from "next";
import Link from "next/link";
import { CommunityShowcase, SHOWCASE_GHOST, SHOWCASE_PRIMARY } from "@/components/community/CommunityShowcase";
import { ForumList } from "@/components/community/ForumList";
import { PageHead } from "@/components/community/PageHead";
import { SideCard } from "@/components/community/SideCard";
import { forumIndexCached } from "@/lib/community/cached";
import { formatWhen, plural } from "@/lib/community/format";
import { FORUM_SOLVED_XP } from "@/lib/community/rewards";
import { showcaseShotsCached } from "@/lib/community/showcase";

export const metadata: Metadata = {
  title: "Fórum | Tralked",
  description: "Dúvidas de conquistas, rotas de 100% e conversa sobre jogos com a comunidade Tralked.",
  alternates: { canonical: "/forum" },
};

export default async function ForumPage() {
  const { categories, games, recent } = await forumIndexCached();
  // Only pinned notices (the welcome) so far: the forum opens with an invitation, not empty rows.
  const quiet = recent.every((thread) => thread.pinned);
  const shots = quiet || games.length === 0 ? await showcaseShotsCached(3) : [];
  const askHref = `/forum/${categories.find((c) => c.slug === "ajuda")?.slug ?? categories[0]?.slug ?? ""}`;

  return (
    <div className="flex flex-col gap-10">
      <PageHead
        title="Fórum"
        lede="Tire dúvidas de conquistas, troque rotas de 100% e ajude quem está travado. A resposta que resolve rende XP de Sábio para quem ajudou."
      />

      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-10 max-[1000px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-12">
          {quiet ? (
            <CommunityShowcase
              id="forum-vazio"
              title="A conversa está só começando"
              text="Ainda não há tópicos de jogadores. Pergunte sobre aquela conquista travada, conte a sua rota de 100% ou abra o fórum do jogo que você está jogando."
              xp={`+${FORUM_SOLVED_XP} XP`}
              xpNote="em Sábio por resposta que resolve"
              shots={shots}
              shotHref={(slug) => `/forum/${slug}`}
              actions={
                <>
                  <Link href={askHref} className={SHOWCASE_PRIMARY}>
                    Abrir um tópico
                  </Link>
                  <Link href="/como-funciona#de-onde-vem" className={SHOWCASE_GHOST}>
                    Como funciona o XP
                  </Link>
                </>
              }
            />
          ) : null}
          <section aria-labelledby="secoes" className="flex flex-col gap-4">
            <h2 id="secoes" className="text-[22px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
              Seções
            </h2>
            <ul className="m-0 grid list-none grid-cols-1 gap-px border border-line bg-line p-0">
              {categories.map((category) => (
                <li key={category.slug} className="bg-surface">
                  <Link
                    href={`/forum/${category.slug}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-5 py-5 hover:bg-hover"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[19px] font-black font-stretch-[112%] tracking-[-0.01em] group-hover:text-acc">
                        {category.name}
                      </span>
                      <span className="text-[14.5px] text-muted">{category.description}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1 text-right font-mono text-xs text-dim">
                      <b className="text-[13px] font-bold text-text-2 tabular-nums">
                        {plural(category.threadCount, "tópico", "tópicos")}
                      </b>
                      {category.lastPostAt ? <span>{formatWhen(category.lastPostAt)}</span> : <span>sem tópicos</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="recentes" className="flex flex-col gap-4">
            <h2 id="recentes" className="text-[22px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
              Movimento recente
            </h2>
            <ForumList threads={recent} showSection label="Tópicos com atividade recente" empty="Nenhum tópico ainda." />
          </section>
        </div>

        <aside className="flex flex-col gap-4" aria-label="Tópicos por jogo e regras">
          <SideCard title="Tópicos por jogo">
            {games.length > 0 ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {games.map((game) => (
                  <li key={game.slug} className="border-b border-divider last:border-b-0">
                    <Link
                      href={`/forum/${game.slug}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-[15px] hover:text-acc"
                    >
                      <span className="truncate">{game.name}</span>
                      <span className="font-mono text-xs text-dim tabular-nums">{game.threadCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-2.5">
                <p className="text-[14px] text-muted">Nenhum jogo tem tópicos ainda. Comece pelo de um destes:</p>
                <ul className="m-0 flex list-none flex-col p-0">
                  {shots.map((game) => (
                    <li key={game.slug} className="border-b border-divider last:border-b-0">
                      <Link
                        href={`/forum/${game.slug}`}
                        className="flex min-h-11 items-center justify-between gap-3 text-[15px] hover:text-acc"
                      >
                        <span className="truncate">{game.name}</span>
                        <span aria-hidden="true" className="font-mono text-xs text-acc">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SideCard>
          <SideCard title="Como funciona">
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[14px] text-muted">
              <li>Quem abriu o tópico marca a resposta que resolveu.</li>
              <li>
                A resposta marcada rende <b className="text-acc">{FORUM_SOLVED_XP} XP em Sábio</b> para quem ajudou.
              </li>
              <li>Marque spoilers e seja gentil. Denuncie o que passar do ponto.</li>
            </ul>
          </SideCard>
        </aside>
      </div>
    </div>
  );
}
