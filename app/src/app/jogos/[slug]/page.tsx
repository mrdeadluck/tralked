import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense, type CSSProperties } from "react";
import { PhotoGrid } from "@/components/community/PhotoGrid";
import { AttributesGained } from "@/components/game/AttributesGained";
import { BookletProgress, BookletSpread } from "@/components/game/BookletSpread";
import { CaseIntro } from "@/components/game/CaseIntro";
import { IntroVeil } from "@/components/game/IntroVeil";
import { FamilyPlayers } from "@/components/game/FamilyPlayers";
import { MediaRail } from "@/components/game/MediaRail";
import { ShotsRail } from "@/components/game/ShotsRail";
import { SimilarShelf } from "@/components/game/SimilarShelf";
import { loginHref } from "@/components/guide/format";
import { NewsTabs } from "@/components/news/NewsTabs";
import { NewsWire } from "@/components/news/NewsWire";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  getGameProfile,
  getGameProfileForUser,
  PLATFORM_NAME,
  type GameProfile,
} from "@/lib/queries/game-profile";
import { listGameSlugs } from "@/lib/queries/games";
import { gameMetadata } from "./metadata";

export async function generateStaticParams() {
  return (await listGameSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/jogos/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return gameMetadata(slug);
}

/*
 * Game profile, preview/tralked-jogo.html: the open booklet of a physical case. Public data comes
 * from one cached profile (static shell, real 404); the visitor's progress, attributes, family and
 * the first-visit case intro are per-request islands. Without JS the page is complete and the
 * intro never appears.
 */

const CSS = `
.gp { display: flex; flex-direction: column; gap: 64px; }
.gp-veil { transition: opacity .8s ease, transform .8s cubic-bezier(.2,.8,.2,1); transition-delay: var(--d, 0s); }
.gp[data-intro="pending"] .gp-veil, .gp[data-intro="stage"] .gp-veil { opacity: 0; transform: translateY(14px); }
.gp[data-intro="pending"] .gpp-val, .gp[data-intro="stage"] .gpp-val { stroke-dasharray: 0 302; }
.gp[data-intro] .gpp-hold .gpd { opacity: 0; }
.gp[data-reveal="instant"] .gp-veil, .gp[data-reveal="instant"] .gpp-val, .gp[data-reveal="instant"] .gpp-hold .gpd { transition: none; }
/* If the intro never takes over (script error, slow network), the page shows itself anyway. */
.gp[data-intro="pending"] .gp-veil, .gp[data-intro="pending"] .gpp-hold .gpd { animation: gp-failsafe .6s ease 3.5s forwards; }
.gp[data-intro="pending"] .gpp-val { animation: gp-failsafe-ring 1.4s cubic-bezier(.2,.8,.2,1) 3.5s forwards; }
@keyframes gp-failsafe { to { opacity: 1; transform: none; } }
@keyframes gp-failsafe-ring { to { stroke-dasharray: var(--ring); } }
.gp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 2px solid var(--text); margin-bottom: 20px; flex-wrap: wrap; }
.gp-head h2 { font-weight: 900; font-stretch: 125%; font-size: 26px; line-height: 1; letter-spacing: -0.03em; text-transform: uppercase; }
.gp-aside { font-family: var(--font-jetbrains-mono), monospace; font-size: 11.5px; letter-spacing: .06em; color: var(--muted); }
a.gp-aside, .gp-aside-link { color: var(--acc); text-transform: uppercase; letter-spacing: .08em; }
a.gp-aside:hover { text-decoration: underline; text-underline-offset: 3px; }
.gp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 2px; border: 1px solid var(--border-2); background: transparent; font-family: var(--font-jetbrains-mono), monospace; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; color: var(--text); white-space: nowrap; }
.gp-btn:hover { border-color: var(--text); }
.gp-btn svg { width: 16px; height: 16px; }
.gp-btn-acc { background: var(--acc); border-color: var(--acc); color: var(--bg); }
.gp-btn-acc:hover { filter: brightness(1.08); border-color: var(--acc); }
.gp-news { display: flex; flex-direction: column; gap: 26px; }
.gp-news .gp-head { margin-bottom: 0; }
.gp-empty { color: var(--muted); }
.gp-gal { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; align-items: start; }
.gp-gal-side { display: flex; flex-direction: column; gap: 16px; }
.gp-side { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.gp-side h3 { font-weight: 900; font-stretch: 125%; font-size: 18px; text-transform: uppercase; letter-spacing: -0.02em; }
.gp-side p { font-size: 14px; color: var(--muted); }
.gp-side .gpf { align-self: stretch; }
.gp-credits { font-family: var(--font-jetbrains-mono), monospace; font-size: 11px; letter-spacing: .04em; color: var(--dim); margin-top: -32px; }
.gp-credits a { color: var(--text-2); text-decoration: underline; text-decoration-color: var(--border-2); text-underline-offset: 3px; }
.gp-credits a:hover { color: var(--acc); text-decoration-color: currentColor; }
@media (max-width: 1000px) { .gp-gal { grid-template-columns: 1fr; } }
`;

const sessionUser = cache(getSessionUser);
const visitor = cache(async (slug: string) => {
  const user = await sessionUser();
  if (!user) return null;
  return { id: user.id, profile: await getGameProfileForUser(slug, user.id) };
});

const delay = (d: string) => ({ "--d": d }) as CSSProperties;

async function IntroIsland({ profile }: { profile: GameProfile }) {
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
      discArt={profile.art.hero ?? profile.art.cover}
      platformLabel={platformLabel}
      plat={Boolean(best?.completed)}
      discLabel={best?.completed ? `PLATINADO · ${best.best.unlocked}/${best.best.total}` : "TRALKED · DISCO 1"}
      bookletNote={profile.guide ? "Guia de conquistas 100%" : "Encarte do jogo"}
      account={me ? { opened: Boolean(me.profile?.opened) } : null}
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

  const login = loginHref(`/jogos/${profile.slug}`);
  const { news, gallery } = profile;

  return (
    <div id="gp-root" className="gp" suppressHydrationWarning>
      <IntroVeil slug={profile.slug} />
      <style href="tralked-game-page" precedence="default">
        {CSS}
      </style>
      <Suspense fallback={null}>
        <IntroIsland profile={profile} />
      </Suspense>

      <BookletSpread
        profile={profile}
        progress={
          <Suspense fallback={<BookletProgress profile={profile} loginHref={login} />}>
            <ProgressIsland profile={profile} login={login} />
          </Suspense>
        }
      />

      <Suspense
        fallback={
          <AttributesGained attributes={null} loggedIn={false} genre={profile.genres[0] ?? null} aside={null} loginHref={login} />
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

      <section className="gp-news gp-veil" aria-labelledby="gp-h-news">
        <div className="gp-head">
          <h2 id="gp-h-news">Notícias de {profile.name}</h2>
          <a className="gp-aside" href={`/forum/${profile.slug}`}>
            Conversar no fórum do jogo →
          </a>
        </div>
        {news.count > 0 ? (
          <NewsTabs
            tabs={news.tabs}
            mostRead={news.mostRead}
            mostReadTitle="Mais lidas do jogo"
            label={`Categorias de notícias de ${profile.name}`}
          />
        ) : (
          <p className="gp-empty">Ainda não há notícias sobre {profile.name}. Assim que sair alguma, ela aparece aqui.</p>
        )}
      </section>

      <section className="gp-veil" aria-labelledby="gp-h-gal">
        <div className="gp-head">
          <h2 id="gp-h-gal">Galeria da comunidade</h2>
          <a className="gp-aside" href={`/galeria?jogo=${profile.slug}`}>
            {gallery.total === 1 ? "1 foto marcada neste jogo" : `${gallery.total.toLocaleString("pt-BR")} fotos marcadas neste jogo`} →
          </a>
        </div>
        <div className="gp-gal">
          <PhotoGrid
            photos={gallery.photos}
            label={`Fotos de ${profile.name}`}
            empty={`Ainda não há fotos de ${profile.name}. Que tal enviar a primeira?`}
          />
          <div className="gp-gal-side">
            <div className="gp-side">
              <h3>Poste sua foto</h3>
              <p>
                Capturas do seu jogo aparecem aqui e no seu perfil. A foto mais curtida da semana ganha destaque e XP.
              </p>
              <a className="gp-btn gp-btn-acc" href={`/galeria?jogo=${profile.slug}`}>
                Enviar foto
              </a>
            </div>
            <Suspense fallback={<FamilyPlayers players={null} loggedIn={false} gameName={profile.name} />}>
              <FamilyIsland profile={profile} />
            </Suspense>
          </div>
        </div>
      </section>

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
        </a>{" "}
        · Arte:{" "}
        <a href="https://www.steamgriddb.com" target="_blank" rel="noopener noreferrer">
          SteamGridDB
        </a>
      </p>
    </div>
  );
}
