import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FactsStrip } from "@/components/games/FactsStrip";
import { GameHead } from "@/components/games/GameHead";
import { AchievementList } from "@/components/guide/AchievementList";
import { Collectibles } from "@/components/guide/Collectibles";
import { CommunityTips } from "@/components/guide/CommunityTips";
import { GuideSidebar } from "@/components/guide/GuideSidebar";
import { Overview } from "@/components/guide/Overview";
import { Revisions } from "@/components/guide/Revisions";
import { Roadmap } from "@/components/guide/Roadmap";
import { getSessionUser } from "@/lib/auth/session";
import { getGameTitle, getGuide } from "@/lib/queries/games";
import { gameMetadata } from "../metadata";

export async function generateMetadata({
  params,
}: PageProps<"/jogos/[slug]/guia">): Promise<Metadata> {
  const { slug } = await params;
  return gameMetadata(slug);
}

export default function GuidePage({ params }: PageProps<"/jogos/[slug]/guia">) {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <GuideContent params={params} />
    </Suspense>
  );
}

async function GuideContent({ params }: Pick<PageProps<"/jogos/[slug]/guia">, "params">) {
  const { slug } = await params;
  // Relative dates ("há 3 dias") need the request time; opt this subtree into request-time rendering.
  await connection();
  const user = await getSessionUser();
  const now = new Date();

  const guide = await getGuide(slug, user?.id);
  if (!guide) {
    // The game exists but has no published guide: send people to the game page.
    if (await getGameTitle(slug)) redirect(`/jogos/${slug}`);
    notFound();
  }

  const loggedIn = Boolean(user);
  const returnTo = `/jogos/${slug}/guia`;

  return (
    <>
      <GameHead game={guide.game} now={now} />
      <FactsStrip facts={guide.facts} totalXp={guide.totals.xp} />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-12 max-[1100px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-14">
          <Overview overview={guide.overview} warnings={guide.warnings} />
          <Roadmap steps={guide.steps} loggedIn={loggedIn} returnTo={returnTo} />
          <AchievementList
            achievements={guide.achievements}
            totalCount={guide.game.achievementCount}
          />
          <Collectibles collectibles={guide.collectibles} />
          <CommunityTips tips={guide.tips} loggedIn={loggedIn} returnTo={returnTo} />
          <Revisions revisions={guide.revisions} now={now} />
        </div>
        <GuideSidebar guide={guide} loggedIn={loggedIn} returnTo={returnTo} />
      </div>
    </>
  );
}
