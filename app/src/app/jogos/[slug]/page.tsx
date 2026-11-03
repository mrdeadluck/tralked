import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense, type CSSProperties } from "react";
import { PhotoGrid } from "@/components/community/PhotoGrid";
import { AttributesGained } from "@/components/game/AttributesGained";
import { BookletProgress, BookletSpread } from "@/components/game/BookletSpread";
import { CaseIntro } from "@/components/game/CaseIntro";
import { backCover, bookletArt, bookletRows } from "@/components/game/case-data";
import { CommunityInvite } from "@/components/game/CommunityInvite";
import { IntroVeil } from "@/components/game/IntroVeil";
import { FamilyPlayers } from "@/components/game/FamilyPlayers";
import { MediaRail } from "@/components/game/MediaRail";
import { RetroAchievementsLoader } from "@/components/game/RetroAchievementsLoader";
import { ShotsRail } from "@/components/game/ShotsRail";
import { SimilarShelf } from "@/components/game/SimilarShelf";
import { loginHref } from "@/components/guide/format";
import { NewsTabs } from "@/components/news/NewsTabs";
import { NewsWire } from "@/components/news/NewsWire";
import { getSessionUser } from "@/lib/auth/session";
import { PHOTO_XP } from "@/lib/community/rewards";
import { prisma } from "@/lib/db";
import {
  getGameProfile,
  getGameProfileForUser,
  PLATFORM_NAME,
  type GameProfile,
} from "@/lib/queries/game-profile";
import { listGameSlugs } from "@/lib/queries/games";
import { getRetroAchievementsDue } from "@/lib/queries/retro-achievements";
import { getSteamPlayers, type SteamPlayersView } from "@/lib/queries/steam-players";
import { JsonLd, videoGameJsonLd } from "@/lib/seo/json-ld";
import { gameMetadata } from "./metadata";

export async function generateStaticParams() {
  // The most played games (capped). Cache Components needs at least one sample: on an empty
  // catalog the placeholder renders a real 404; unknown slugs render on demand.
  const slugs = await listGameSlugs();
  return (slugs.length > 0 ? slugs : ["exemplo"]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/jogos/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return gameMetadata(slug);
}

/*
 * Game profile: a graphite hero with the game's art, its disc and progress, the ficha técnica. Public data comes
 * from one cached profile (static shell, real 404); the visitor's progress, attributes, family and
 * the first-visit case intro are per-request islands. Without JS the page is complete and the
 * intro never appears.
 */

const CSS = `
.gp { display: flex; flex-direction: column; gap: 44px; }
.gp-veil { transition: opacity .8s ease, transform .8s cubic-bezier(.2,.8,.2,1); transition-delay: var(--d, 0s); }
.gp[data-intro="pending"] .gp-veil, .gp[data-intro="stage"] .gp-veil { opacity: 0; transform: translateY(14px); }
.gp[data-intro="pending"] .gpp-val, .gp[data-intro="stage"] .gpp-val { stroke-dasharray: 0 302; }
.gp[data-intro] .gpp-hold .gpd, .gp[data-intro] .gpp-stamp { opacity: 0; }
.gp[data-reveal="instant"] .gp-veil, .gp[data-reveal="instant"] .gpp-val, .gp[data-reveal="instant"] .gpp-hold .gpd { transition: none; }
/* If the intro never takes over (script error, slow network), the page shows itself anyway. */
.gp[data-intro="pending"] .gp-veil, .gp[data-intro="pending"] .gpp-hold .gpd { animation: gp-failsafe .6s ease 3.5s forwards; }
.gp[data-intro="pending"] .gpp-val { animation: gp-failsafe-ring 1.4s cubic-bezier(.2,.8,.2,1) 3.5s forwards; }
@keyframes gp-failsafe { to { opacity: 1; transform: none; } }
@keyframes gp-failsafe-ring { to { stroke-dasharray: var(--ring); } }
/* Section heads: a heavy rule with a lime marker, condensed labels on the side. */
.gp-head { position: relative; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 16px; padding-bottom: 10px; margin-bottom: 16px; border-bottom: 2px solid var(--border-2); }
.gp-head::after { content: ""; position: absolute; left: 0; bottom: -2px; width: 64px; height: 2px; background: var(--acc); }
.gp-head h2 { font-weight: 900; font-stretch: 112%; font-size: 22px; line-height: 1.05; letter-spacing: -0.01em; text-transform: uppercase; }
.gp-aside { font-size: 13.5px; color: var(--muted); }
a.gp-aside, .gp-aside-link { color: var(--acc); font-stretch: 80%; font-weight: 750; font-size: 12.5px; letter-spacing: .05em; text-transform: uppercase; }
a.gp-aside:hover { text-decoration: underline; text-underline-offset: 3px; }
/* Buttons: square; the primary is lime with the cut corner (tk-cut-b on the element). */
.gp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 18px; border: 0; background: transparent; box-shadow: inset 0 0 0 1px var(--border-2); font: inherit; font-stretch: 80%; font-weight: 800; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; color: var(--text); white-space: nowrap; transition: box-shadow .15s, background .15s, filter .15s; }
.gp-btn:hover { box-shadow: inset 0 0 0 1px var(--text); }
.gp-btn:active { translate: 0 1px; }
.gp-btn svg { width: 16px; height: 16px; }
.gp-btn-s { background: var(--hover-2); box-shadow: none; }
.gp-btn-s:hover { background: var(--border-2); box-shadow: none; }
.gp-btn-acc { background: var(--acc); box-shadow: none; color: var(--acc-ink); }
.gp-btn-acc:hover { filter: brightness(1.08); box-shadow: none; }
.gp-news { display: flex; flex-direction: column; gap: 4px; }
.gp-news .gp-head { margin-bottom: 0; }
.gp-gal { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
.gp-gal-side { display: flex; flex-direction: column; gap: 12px; }
.gp-side { position: relative; background: var(--surface); padding: 18px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.gp-side::before { content: ""; position: absolute; left: 0; right: 10px; top: 0; height: 2px; background: var(--border-2); }
.gp-side h3 { font-stretch: 80%; font-weight: 850; font-size: 17px; letter-spacing: .06em; text-transform: uppercase; }
.gp-side p { font-size: 14px; color: var(--text-2); }
.gp-side .gpf { align-self: stretch; }
.gp-credits { font-size: 12.5px; color: var(--muted); margin-top: -12px; }
.gp-credits a { color: var(--text-2); text-decoration: underline; text-decoration-color: var(--border-2); text-underline-offset: 3px; }
.gp-credits a:hover { color: var(--acc); text-decoration-color: currentColor; }
/* The news tabs (shared component) in this page's graphite: square, condensed labels. */
.gp-news .tkt { gap: 12px; }
.gp-news .tkt-list { gap: 2px; border-bottom: 0; }
.gp-news .tkt-tab { height: 36px; padding: 0 12px; background: var(--surface); font-family: inherit; font-stretch: 80%; font-weight: 800; font-size: 12.5px; letter-spacing: .06em; color: var(--text-2); }
.gp-news .tkt-tab[aria-selected="true"] { background: var(--hover-2); color: var(--text); }
.gp-news .tkt-tab sup { font-size: 11.5px; }
.gp-news .tkt-panel { gap: 12px; }
.gp-news .tkt-lead, .gp-news .tkt-sec, .gp-news .tkt-next a, .gp-news .tkt-thumb { border-radius: 0; }
.gp-news .tkt-lead, .gp-news .tkt-sec { clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
.gp-news .tkt-kick { font-family: inherit; font-stretch: 75%; font-weight: 800; font-size: 11.5px; letter-spacing: .08em; }
.gp-news .tkt-meta, .gp-news .tkt-next small, .gp-news .tkt-most small { font-family: inherit; font-size: 12px; color: var(--muted); }
.gp-news .tkt-most { position: relative; border: 0; border-radius: 0; padding: 16px; }
.gp-news .tkt-most::before { content: ""; position: absolute; left: 0; right: 10px; top: 0; height: 2px; background: var(--acc); }
.gp-news .tkt-most h3 { font-stretch: 80%; font-weight: 850; font-size: 17px; letter-spacing: .06em; border-bottom-color: var(--divider); }
.gp-news .tkt-most li::before { font-stretch: 112%; font-size: 18px; line-height: 1.1; color: var(--acc); }
.gp-news .tkt-next a { border: 0; }
.gp-news .tkt-more { font-family: inherit; font-stretch: 80%; font-weight: 750; font-size: 12.5px; letter-spacing: .05em; }
@media (max-width: 1000px) { .gp-gal { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .gp { gap: 36px; } .gp-head h2 { font-size: 19px; } }
`;

const sessionUser = cache(getSessionUser);
const visitor = cache(async (slug: string) => {
  const user = await sessionUser();
  if (!user) return null;
  return { id: user.id, introOff: user.caseIntroOff, profile: await getGameProfileForUser(slug, user.id) };
});

const delay = (d: string) => ({ "--d": d }) as CSSProperties;

async function IntroIsland({ profile, steamPlayers }: { profile: GameProfile; steamPlayers: SteamPlayersView | null }) {
  const me = await visitor(profile.slug);
  const best = me?.profile?.progress;
  const platformLabel = best
    ? best.platforms.map((p) => PLATFORM_NAME[p.platform]).join(" · ").toUpperCase()
    : profile.platforms.includes("PC")
      ? "PC · STEAM"
      : (profile.platforms[0] ?? "TRALKED");
  return (
    <CaseIntro
      key={profile.slug}
      gameId={profile.id}
      slug={profile.slug}
      name={profile.name}
      hues={profile.hues}
      seed={profile.seed}
      coverUrl={profile.art.cover}
      wideArt={profile.art.hero ?? profile.shots.find((s) => s.url)?.url ?? null}
      bookletArt={bookletArt(profile)}
      logoUrl={profile.art.logo}
      bookletRows={bookletRows(profile)}
      back={backCover(profile, steamPlayers)}
      disc={profile.art.disc}
      platformLabel={platformLabel}
      plat={Boolean(best?.completed)}
      discLabel={best?.completed ? `TRALKED! · ${best.best.unlocked}/${best.best.total}` : "TRALKED · DISCO 1"}
      bookletNote={profile.guide ? "Guia de conquistas 100%" : "Encarte do jogo"}
      account={me ? { opened: Boolean(me.profile?.opened), introOff: me.introOff } : null}
    />
  );
}

async function ProgressIsland({ profile, login }: { profile: GameProfile; login: string }) {
  const me = await visitor(profile.slug);
  return <BookletProgress profile={profile} user={me ? (me.profile ?? null) : undefined} loginHref={login} />;
}

function attributesAside(profile: NonNullable<Awaited<ReturnType<typeof getGameProfileForUser>>>) {
  const progress = profile.progress;
  if (!progress) return null;
  const hours = Math.round(progress.playtimeMin / 60).toLocaleString("pt-BR");
  return `${progress.platforms.map((p) => PLATFORM_NAME[p.platform]).join(" · ")} · ${hours} h jogadas`;
}

async function AttributesIsland({ profile, login }: { profile: GameProfile; login: string }) {
  const me = await visitor(profile.slug);
  return (
    <AttributesGained
      attributes={me?.profile?.attributes ?? null}
      loggedIn={me !== null}
      genre={profile.genres[0] ?? null}
      aside={me?.profile ? attributesAside(me.profile) : null}
      loginHref={login}
      sample={profile.sample}
      gameName={profile.name}
    />
  );
}

async function FamilyIsland({ profile }: { profile: GameProfile }) {
  const me = await visitor(profile.slug);
  return <FamilyPlayers players={me?.profile?.family ?? null} loggedIn={me !== null} gameName={profile.name} />;
}

/** Logged in, the shelf leaves out games the visitor already opened. */
async function ShelfIsland({ profile }: { profile: GameProfile }) {
  const me = await visitor(profile.slug);
  if (!me) return <SimilarShelf games={profile.similar.slice(0, 8)} aside="Jogos com as mesmas habilidades" />;
  const opened = await prisma.gameOpen.findMany({
    where: { userId: me.id, game: { slug: { in: profile.similar.map((g) => g.slug) } } },
    select: { game: { select: { slug: true } } },
  });
  const seen = new Set(opened.map((o) => o.game.slug));
  return (
    <SimilarShelf
      games={profile.similar.filter((g) => !seen.has(g.slug)).slice(0, 8)}
      aside="Jogos parecidos que você ainda não abriu"
    />
  );
}

export default async function GamePage({ params }: PageProps<"/jogos/[slug]">) {
  // Public data comes from cache, so an unknown slug is a real 404 before anything streams.
  const { slug } = await params;
  const profile = await getGameProfile(slug);
  if (!profile) notFound();
  // Cached on their own: the hourly Steam samples change faster than the profile, and the RA flag
  // is expired by the action that reads the RA list.
  const [steamPlayers, retroDue] = await Promise.all([
    getSteamPlayers(profile.id),
    getRetroAchievementsDue(profile.id, profile.slug),
  ]);

  const login = loginHref(`/jogos/${profile.slug}`);
  const { news, gallery } = profile;
  const family = (
    <Suspense fallback={<FamilyPlayers players={null} loggedIn={false} gameName={profile.name} />}>
      <FamilyIsland profile={profile} />
    </Suspense>
  );

  return (
    <div id="gp-root" className="gp" suppressHydrationWarning>
      {/* Public, from the cached profile: part of the static shell. */}
      <JsonLd
        data={videoGameJsonLd({
          slug: profile.slug,
          name: profile.name,
          summary: profile.summary,
          coverUrl: profile.art.cover,
          platforms: profile.platforms,
        })}
      />
      <IntroVeil slug={profile.slug} />
      {retroDue ? <RetroAchievementsLoader gameId={profile.id} /> : null}
      <style href="tralked-game-page" precedence="default">
        {CSS}
      </style>
      <Suspense fallback={null}>
        <IntroIsland profile={profile} steamPlayers={steamPlayers} />
      </Suspense>

      <BookletSpread
        profile={profile}
        steamPlayers={steamPlayers}
        progress={
          <Suspense fallback={<BookletProgress profile={profile} loginHref={login} />}>
            <ProgressIsland profile={profile} login={login} />
          </Suspense>
        }
      />

      <Suspense
        fallback={
          <AttributesGained
            attributes={null}
            loggedIn={false}
            genre={profile.genres[0] ?? null}
            aside={null}
            loginHref={login}
            sample={profile.sample}
            gameName={profile.name}
          />
        }
      >
        <AttributesIsland profile={profile} login={login} />
      </Suspense>

      <MediaRail videos={profile.videos} gameName={profile.name} hues={profile.hues} seed={profile.seed} />
      <ShotsRail shots={profile.shots} gameName={profile.name} hues={profile.hues} />

      {/* The moving wire needs a few cards to read as one; the tabs below list every story anyway. */}
      {news.wire.length >= 3 ? (
        <NewsWire
          items={news.wire}
          description={`Tudo o que sai sobre ${profile.name}, da redação e da imprensa`}
          label={`Notícias sobre ${profile.name} em movimento`}
          className="gp-veil"
        />
      ) : null}

      {news.count > 0 ? (
        <section className="gp-news gp-veil" aria-labelledby="gp-h-news">
          <div className="gp-head">
            <h2 id="gp-h-news">Notícias de {profile.name}</h2>
            <a className="gp-aside" href={`/forum/${profile.slug}`}>
              Conversar no fórum do jogo
            </a>
          </div>
          <NewsTabs
            tabs={news.tabs}
            mostRead={news.mostRead}
            mostReadTitle="Mais lidas do jogo"
            label={`Categorias de notícias de ${profile.name}`}
          />
        </section>
      ) : news.studio ? (
        // No story about this game yet: the newest about its studio's other games.
        <section className="gp-news gp-veil" aria-labelledby="gp-h-news">
          <div className="gp-head">
            <h2 id="gp-h-news">Notícias de {news.studio.name}</h2>
            <span className="gp-aside">Do mesmo estúdio de {profile.name}</span>
          </div>
          <NewsTabs
            tabs={[{ id: "estudio", label: "Do mesmo estúdio", stories: news.studio.stories }]}
            mostRead={[]}
            label={`Notícias de ${news.studio.name}`}
          />
        </section>
      ) : null}

      {gallery.total === 0 ? (
        <CommunityInvite
          name={profile.name}
          slug={profile.slug}
          shots={profile.shots}
          hues={profile.hues}
          withNews={news.count > 0}
          side={family}
        />
      ) : (
        <section className="gp-veil" aria-labelledby="gp-h-gal">
          <div className="gp-head">
            <h2 id="gp-h-gal">Galeria da comunidade</h2>
            <a className="gp-aside" href={`/galeria?jogo=${profile.slug}`}>
              {gallery.total === 1 ? "1 foto marcada neste jogo" : `${gallery.total.toLocaleString("pt-BR")} fotos marcadas neste jogo`}
            </a>
          </div>
          <div className="gp-gal">
            <PhotoGrid
              photos={gallery.photos}
              label={`Fotos de ${profile.name}`}
              invite={{ href: `/galeria?jogo=${profile.slug}`, min: 3 }}
              empty={`Ainda não há fotos de ${profile.name}. Que tal enviar a primeira?`}
            />
            <div className="gp-gal-side">
              <div className="gp-side">
                <h3>Poste sua foto</h3>
                <p>
                  Capturas do seu jogo aparecem aqui e no seu perfil. Cada foto rende +{PHOTO_XP} XP.
                </p>
                <a className="gp-btn gp-btn-acc tk-cut-b" href={`/galeria?jogo=${profile.slug}`}>
                  Enviar foto
                </a>
              </div>
              {family}
            </div>
          </div>
        </section>
      )}

      <Suspense fallback={<SimilarShelf games={profile.similar.slice(0, 8)} aside="Jogos com as mesmas habilidades" />}>
        <ShelfIsland profile={profile} />
      </Suspense>

      <p className="gp-credits gp-veil" style={delay("0s")}>
        Dados de jogos:{" "}
        <a href="https://store.steampowered.com" target="_blank" rel="noopener noreferrer">
          Steam
        </a>
        ,{" "}
        <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
          IGDB
        </a>
        ,{" "}
        <a href="https://rawg.io" target="_blank" rel="noopener noreferrer">
          RAWG
        </a>
        ,{" "}
        <a href="https://retroachievements.org" target="_blank" rel="noopener noreferrer">
          RetroAchievements
        </a>{" "}
        · Arte:{" "}
        <a href="https://www.steamgriddb.com" target="_blank" rel="noopener noreferrer">
          SteamGridDB
        </a>
      </p>
    </div>
  );
}
