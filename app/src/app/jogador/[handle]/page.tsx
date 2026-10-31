import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivityFeed } from "@/components/character/ActivityFeed";
import { AlmostThere } from "@/components/character/AlmostThere";
import { AttributesWindow } from "@/components/character/AttributesWindow";
import { CharacterCard } from "@/components/character/CharacterCard";
import { formatAgo } from "@/components/character/format";
import { MissionsCard } from "@/components/character/MissionsCard";
import { PlayerGallery } from "@/components/character/PlayerGallery";
import { SkillsWindow } from "@/components/character/SkillsWindow";
import { StreakCard } from "@/components/character/StreakCard";
import { SyncActions } from "@/components/character/SyncActions";
import { TrophyTiers } from "@/components/character/TrophyTiers";
import { Card } from "@/components/ui/Card";
import { getSessionUser } from "@/lib/auth/session";
import { pendingDespertar } from "@/lib/character/despertar";
import { getCharacterSheetExtras } from "@/lib/character/sheet";
import { getCharacter, getPlayerHeader, hoursUntilDailyReset } from "@/lib/queries/players";

const STEAM_PRIVACY_SETTINGS_URL = "https://steamcommunity.com/my/edit/settings";

export default function PlayerPage({ params }: PageProps<"/jogador/[handle]">) {
  return (
    <Suspense fallback={<SheetSkeleton />}>
      <PlayerSheet params={params} />
    </Suspense>
  );
}

function SheetSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando personagem" className="flex flex-col gap-10">
      <div className="h-[420px] animate-pulse rounded-[4px] border border-line bg-surface" />
      <div className="h-[260px] animate-pulse rounded-[4px] border border-line bg-surface" />
    </div>
  );
}

async function PlayerSheet({ params }: { params: PageProps<"/jogador/[handle]">["params"] }) {
  const { handle } = await params;
  const [header, viewer] = await Promise.all([getPlayerHeader(handle), getSessionUser()]);
  if (!header) notFound();

  const isOwner = viewer?.id === header.id;

  if (!header.profilePublic && !isOwner) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">
          Personagem
        </span>
        <h1 className="mt-1.5 text-3xl leading-none font-black font-stretch-[125%] tracking-[-0.035em] break-words uppercase">
          {header.displayName}
        </h1>
        <p className="mt-4 text-muted">Este perfil é privado.</p>
      </Card>
    );
  }

  const character = await getCharacter(header.handle);
  if (!character) notFound();
  const [extras, despertar] = await Promise.all([
    getCharacterSheetExtras(character.userId),
    isOwner ? pendingDespertar(character.userId) : Promise.resolve(null),
  ]);

  const now = new Date();
  const daily = character.missions.filter((m) => m.kind === "daily");
  const weekly = character.missions.filter((m) => m.kind === "weekly");

  return (
    <div className="flex flex-col gap-10">
      {isOwner && !character.profilePublic && extras.steamSyncFailing ? (
        <div
          role="alert"
          className="rounded-[2px] border border-rarity-lendario bg-surface px-[18px] py-4 text-sm text-text-2"
        >
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
        <p className="rounded-[2px] border border-line-2 bg-surface px-[18px] py-4 text-sm text-text-2">
          Seu perfil está privado: só você vê esta ficha, e ela fica fora dos highscores.{" "}
          <Link href="/conta" className="font-semibold text-acc underline underline-offset-2">
            Mudar em Conta
          </Link>
        </p>
      ) : null}

      <div className="grid gap-5 min-[901px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <CharacterCard
          character={character}
          platforms={extras.platforms}
          bio={extras.bio}
          actions={
            isOwner ? (
              <SyncActions
                lastSyncedLabel={
                  character.lastSyncedAt ? formatAgo(character.lastSyncedAt, now) : null
                }
                despertarSteps={despertar}
              />
            ) : null
          }
        />
        <div className="flex flex-col gap-5">
          <StreakCard streak={character.streak} />
          <MissionsCard
            missions={[...daily, ...weekly]}
            resetLabel={`Renovam em ${hoursUntilDailyReset(now)} h`}
          />
        </div>
      </div>

      <AttributesWindow attributes={extras.attributes} />

      <SkillsWindow skills={character.skills} />

      <div className="flex flex-wrap gap-x-5 gap-y-10">
        <div className="min-w-0 flex-[1_1_600px]">
          <AlmostThere games={character.almostThere} />
        </div>
        <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-5">
          <TrophyTiers trophies={extras.trophies} />
          <ActivityFeed items={character.recent} now={now} />
        </aside>
      </div>

      <PlayerGallery
        photos={extras.photos.items}
        total={extras.photos.total}
        displayName={character.displayName}
        isOwner={isOwner}
      />
    </div>
  );
}
