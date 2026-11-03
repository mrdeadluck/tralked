import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivityFeed } from "@/components/character/ActivityFeed";
import { AlmostThere } from "@/components/character/AlmostThere";
import { AttributesWindow } from "@/components/character/AttributesWindow";
import { CharacterStats } from "@/components/character/CharacterCard";
import { formatAgo } from "@/components/character/format";
import { MissionsCard } from "@/components/character/MissionsCard";
import { PlayerSetupSection } from "@/components/character/PlayerSetup";
import { PlayerGallery } from "@/components/character/PlayerGallery";
import { ReactionStatsCard } from "@/components/character/ReactionStatsCard";
import { RecentlyPlayed } from "@/components/character/RecentlyPlayed";
import { Shelf } from "@/components/character/Shelf";
import { SkillsWindow } from "@/components/character/SkillsWindow";
import { StreakCard } from "@/components/character/StreakCard";
import { SyncActions } from "@/components/character/SyncActions";
import { TrophyTiers } from "@/components/character/TrophyTiers";
import { Card } from "@/components/ui/Card";
import { SectionHead } from "@/components/ui/SectionHead";
import { Panel, PANEL_LINK } from "@/components/character/Panel";
import { RareShowcase } from "@/components/profile/RareShowcase";
import { getShelfGames } from "@/lib/library/shelf";
import { getSessionUser } from "@/lib/auth/session";
import { ProfileModeration } from "@/components/moderation/ProfileModeration";
import { canModerate } from "@/lib/moderation/permissions";
import { pendingDespertar } from "@/lib/character/despertar";
import { reactionStats } from "@/lib/community/reactions";
import { profilePath, ProfileTabs } from "@/components/profile/ProfileTabs";
import { getCharacterSheetExtras } from "@/lib/character/sheet";
import { getRecentlyPlayed } from "@/lib/library/queries";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { weeklyXpSplit } from "@/lib/highscores/queries";
import { getProfileSummary, getRarestAchievements } from "@/lib/profile/queries";
import { getPlayerSetup } from "@/lib/setup/queries";
import { getCharacter, hoursUntilDailyReset, type PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";

const STEAM_PRIVACY_SETTINGS_URL = "https://steamcommunity.com/my/edit/settings";

export async function generateStaticParams() {
  // Cache Components needs a sample to validate the route at build time. Profiles are not
  // prerendered: the placeholder renders a real 404 and every handle renders on demand.
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) return { title: "Jogador não encontrado | Tralked", robots: { index: false } };
  if (!header.profilePublic) {
    return { title: `@${header.handle} | Tralked`, robots: { index: false, follow: false } };
  }
  return {
    title: `${header.displayName} (@${header.handle}) | Tralked`,
    description: `Ficha de personagem de ${header.displayName} no Tralked: nível, habilidades, conquistas e troféus.`,
    alternates: { canonical: `/jogador/${header.handle}` },
  };
}

export default async function PlayerPage({ params }: PageProps<"/jogador/[handle]">) {
  // The header comes from cache, so an unknown handle is a real 404 before anything streams;
  // what depends on the visitor (owner or not) streams in below.
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SheetSkeleton />}>
      <PlayerSheet header={header} />
    </Suspense>
  );
}

function SheetSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando personagem" className="flex flex-col gap-10">
      {/* Header and tab bar, as on every profile tab. */}
      <div className="flex flex-col">
        <div className="h-[230px] animate-pulse bg-surface tk-cut" />
        <div className="h-12 border-t border-line bg-surface" />
      </div>
      <div className="h-[420px] animate-pulse bg-surface tk-cut" />
      <div className="h-[260px] animate-pulse bg-surface tk-cut" />
    </div>
  );
}

async function PlayerSheet({ header }: { header: PlayerHeader }) {
  const viewer = await getSessionUser();
  const isOwner = viewer?.id === header.id;

  if (!header.profilePublic && !isOwner) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <span className="tk-lbl">Personagem</span>
        <h1 className="mt-1.5 text-3xl leading-none font-black font-stretch-[125%] tracking-[-0.035em] break-words uppercase">
          {header.displayName}
        </h1>
        <p className="mt-4 text-muted">Este perfil é privado.</p>
      </Card>
    );
  }

  const character = await getCharacter(header.handle);
  if (!character) notFound();
  const [extras, despertar, summary, recentlyPlayed, setup, reactions, week, rarest, shelf] = await Promise.all([
    getCharacterSheetExtras(character.userId),
    isOwner ? pendingDespertar(character.userId) : Promise.resolve(null),
    getProfileSummary(character.userId),
    getRecentlyPlayed(character.userId),
    getPlayerSetup(character.userId),
    reactionStats(character.userId),
    weeklyXpSplit(character.userId),
    getRarestAchievements(character.userId, 6),
    getShelfGames(character.userId, 20),
  ]);
  if (!summary) notFound();

  const now = new Date();
  const daily = character.missions.filter((m) => m.kind === "daily");
  const weekly = character.missions.filter((m) => m.kind === "weekly");

  const calendarHref = isOwner ? "/calendario" : `/calendario?jogador=${encodeURIComponent(character.handle)}`;
  const note = "font-normal font-stretch-100% tracking-normal text-muted normal-case";

  return (
    <div className="flex flex-col">
      {/* The same identity header and tab bar as every profile tab: switching tabs moves nothing. */}
      <ProfileHeader
        summary={summary}
        section="Ficha"
        rank={character.stats.rank}
        week={week}
        bio={extras.bio}
        isOwner={isOwner}
        actions={
          isOwner ? (
            <SyncActions
              lastSyncedLabel={character.lastSyncedAt ? formatAgo(character.lastSyncedAt, now) : null}
              despertarSteps={despertar}
            />
          ) : (
            <ProfileModeration
              userId={character.userId}
              handle={character.handle}
              loggedIn={viewer !== null}
              moderator={canModerate(viewer?.role)}
            />
          )
        }
        strip={<CharacterStats stats={character.stats} week={week} />}
      />
      <ProfileTabs handle={character.handle} active="ficha" summary={summary} />

      {isOwner && !character.profilePublic && extras.steamSyncFailing ? (
        <div role="alert" className="mt-4 border border-rarity-lendario bg-surface px-[18px] py-4 text-sm text-text-2">
          Seu perfil Steam está privado. Deixe-o público para importar suas conquistas e depois
          ative o perfil público em{" "}
          <Link href="/conta" className="font-semibold text-acc underline underline-offset-2">
            Conta
          </Link>
          .{" "}
          <a
            href={STEAM_PRIVACY_SETTINGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-acc underline underline-offset-2"
          >
            Abrir configurações de privacidade da Steam
          </a>
        </div>
      ) : isOwner && !character.profilePublic ? (
        <p className="mt-4 border border-line-2 bg-surface px-[18px] py-4 text-sm text-text-2">
          Seu perfil está privado: só você vê esta ficha, e ela fica fora do ranking.{" "}
          <Link href="/conta" className="font-semibold text-acc underline underline-offset-2">
            Mudar em Conta
          </Link>
        </p>
      ) : null}

      <div className="mt-7 mb-4">
        <SectionHead
          title="Build do personagem"
          aside={<span className={note}>Atributos e skills somam todas as plataformas</span>}
        />
      </div>
      <div className="grid gap-0.5">
        <AttributesWindow attributes={extras.attributes} />
        <SkillsWindow skills={character.skills} />
      </div>

      <div className="mt-9 mb-4">
        <SectionHead
          title="Progresso"
          aside={<span className={note}>O que está perto de fechar e o que já brilha</span>}
        />
      </div>
      <div className="grid items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-4">
          {rarest.length > 0 ? (
            <Panel
              title="Vitrine · mais raras"
              aside={
                <Link href={`${profilePath(character.handle, "conquistas")}?ordem=raras`} className={PANEL_LINK}>
                  Ver todas por raridade
                </Link>
              }
            >
              <RareShowcase achievements={rarest} />
            </Panel>
          ) : null}
          <TrophyTiers trophies={extras.trophies} />
          <AlmostThere games={character.almostThere} />
          <ActivityFeed
            items={character.recent}
            now={now}
            calendar={{ href: calendarHref, label: isOwner ? "Meu calendário" : `Calendário de @${character.handle}` }}
          />
        </div>
        <aside aria-label="Setup, sequência e missões" className="grid min-w-0 gap-4">
          <PlayerSetupSection setup={setup} displayName={character.displayName} isOwner={isOwner} />
          <StreakCard streak={character.streak} />
          <MissionsCard missions={[...daily, ...weekly]} resetLabel={`Renovam em ${hoursUntilDailyReset(now)} h`} />
          <RecentlyPlayed games={recentlyPlayed} now={now} libraryHref={profilePath(character.handle, "jogos")} />
          <ReactionStatsCard stats={reactions} />
        </aside>
      </div>

      <div className="mt-10">
        <Shelf games={shelf} libraryHref={profilePath(character.handle, "jogos")} />
      </div>

      <div className="mt-10">
        <PlayerGallery
          photos={extras.photos.items}
          total={extras.photos.total}
          displayName={character.displayName}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}
