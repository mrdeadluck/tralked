import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { PageHead } from "@/components/community/PageHead";
import { pageParam } from "@/components/community/Pager";
import { FeedList } from "@/components/social/FeedList";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { FEED_MIN_HOURS, FEED_RARE_PCT, getFeed } from "@/lib/social/feed";

export const metadata: Metadata = {
  title: "Feed · Tralked",
  description: "Conquistas raras, 100%, marcos de horas, matérias e fotos de quem você segue.",
  robots: { index: false, follow: false },
};

export default function FeedPage({ searchParams }: PageProps<"/feed">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Feed"
        lede={`O que acontece com quem você segue: conquistas raras (até ${FEED_RARE_PCT}% dos jogadores), jogos em 100%, marcos a partir de ${FEED_MIN_HOURS} h, matérias e fotos. Só aparece a atividade de perfis públicos.`}
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando o feed…</p>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Feed({ searchParams }: { searchParams: PageProps<"/feed">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/feed" />;
  const { pagina } = await searchParams;
  const feed = await getFeed(prisma, user.id, pageParam(pagina));
  const now = new Date();

  if (feed.following === 0) {
    return (
      <p className="max-w-[60ch] text-[15.5px] text-muted">
        Você ainda não segue ninguém. Abra o perfil de outros jogadores (pelos{" "}
        <Link href="/highscores" className="text-acc underline underline-offset-2">
          Highscores
        </Link>
        , pelo fórum ou pela galeria) e toque em Seguir.
      </p>
    );
  }
  if (feed.items.length === 0) {
    return <p className="text-[15.5px] text-muted">Nada novo de quem você segue por enquanto.</p>;
  }
  return (
    <section aria-label="Atividade" className="flex flex-col gap-4">
      <FeedList items={feed.items} now={now} />
      <nav aria-label="Páginas do feed" className="flex items-center gap-4 font-mono text-[12px]">
        {feed.page > 1 ? (
          <Link href={feed.page === 2 ? "/feed" : `/feed?pagina=${feed.page - 1}`} className="text-acc underline underline-offset-2">
            ← Mais recentes
          </Link>
        ) : null}
        {feed.hasMore ? (
          <Link href={`/feed?pagina=${feed.page + 1}`} className="text-acc underline underline-offset-2">
            Mais antigas →
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
