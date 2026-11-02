import { Suspense } from "react";
import { ReportButton } from "@/components/community/ReportButton";
import { currentUser } from "@/lib/community/viewer";
import { canEditArticles, canModerate } from "@/lib/moderation/permissions";
import { CATEGORIES } from "@/lib/queries/news";
import { ArticleModBar } from "./ArticleModBar";
import { GuideModBar } from "./GuideModBar";

/**
 * Per-visitor moderation islands for cached public pages. Each one reads the session inside its
 * own Suspense boundary (the page around it stays static) and renders the newsroom or moderation
 * controls for privileged roles, or the "Denunciar" button for everyone else. The controls only
 * decide what renders: the Server Actions check the role again.
 */

type ArticleProps = { articleId: string; category: string; featured: number; returnTo: string };

const articleReport = (props: ArticleProps, loggedIn: boolean, pending = false) => (
  <ReportButton targetType="article" targetId={props.articleId} loggedIn={loggedIn} returnTo={props.returnTo} what="esta notícia" pending={pending} />
);

async function ArticleIsland(props: ArticleProps) {
  const user = await currentUser();
  if (user && canEditArticles(user.role)) {
    return (
      <ArticleModBar
        articleId={props.articleId}
        category={props.category}
        featured={props.featured}
        categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
      />
    );
  }
  return articleReport(props, user !== null);
}

/** Article page: "Editar" + category/highlight/unpublish for the newsroom, "Denunciar" for others. */
export function ArticleModeration(props: ArticleProps) {
  return (
    <Suspense fallback={articleReport(props, false, true)}>
      <ArticleIsland {...props} />
    </Suspense>
  );
}

type GuideProps = { guideId: string; gameName: string; returnTo: string };

const guideReport = (props: GuideProps, loggedIn: boolean, pending = false) => (
  <ReportButton targetType="guide" targetId={props.guideId} loggedIn={loggedIn} returnTo={props.returnTo} what={`o guia de ${props.gameName}`} pending={pending} />
);

async function GuideIsland(props: GuideProps) {
  const user = await currentUser();
  if (user && canModerate(user.role)) return <GuideModBar guideId={props.guideId} gameName={props.gameName} />;
  return guideReport(props, user !== null);
}

/** Guide page: "Tirar do ar" for moderators, "Denunciar" for others. */
export function GuideModeration(props: GuideProps) {
  return (
    <Suspense fallback={guideReport(props, false, true)}>
      <GuideIsland {...props} />
    </Suspense>
  );
}
