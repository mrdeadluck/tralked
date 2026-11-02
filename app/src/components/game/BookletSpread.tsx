import type { CSSProperties, ReactNode } from "react";
import { GameArt } from "@/components/art/GameArt";
import { PLATFORM_NAME, timeTo100Label, type GameProfile, type GameUserProfile } from "@/lib/queries/game-profile";
import { steamReviewLabel } from "@/lib/games/steam-reviews";
import type { SteamPlayersView } from "@/lib/queries/steam-players";
import { BackdropLoop } from "./BackdropLoop";
import { CaseReplayButton } from "./case-replay";
import { DiscProgress } from "./DiscProgress";
import { PlatformProgressSwitch } from "./PlatformProgressSwitch";
import { PROGRESS_CSS, TrophyGrid } from "./progress-parts";
import { catalogViews, progressViews } from "./progress-views";
import { titleFitStyle } from "./title-fit";

/*
 * The open booklet ("encarte") of preview/tralked-jogo.html: left page with the game's sheet
 * (genres, platforms, title, summary, facts, actions), right page with the visitor's disc and
 * progress (passed in as `progress`, a per-visitor island). Fold shadow down the middle, folios
 * at the foot of each page, the hero art bleeding in from the right.
 */

const CSS = `
.gps { position: relative; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); border-radius: 4px; overflow: hidden; background: var(--paper); box-shadow: 0 40px 90px -40px rgba(0,0,0,.9), inset 0 0 0 1px var(--border); }
.gps::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1; background: repeating-linear-gradient(0deg, rgba(255,255,255,.012) 0 1px, transparent 1px 3px), radial-gradient(ellipse 60% 80% at 100% 0%, rgba(198,244,50,.05), transparent 60%); }
.gps::after { content: ""; position: absolute; top: 0; bottom: 0; left: 53.5%; width: 46px; translate: -50% 0; pointer-events: none; z-index: 1; background: linear-gradient(90deg, transparent, rgba(0,0,0,.45) 48%, rgba(255,255,255,.04) 52%, transparent); }
.gps-art { position: absolute; inset: 0; opacity: .32; pointer-events: none; -webkit-mask: linear-gradient(90deg, transparent 30%, #000 75%); mask: linear-gradient(90deg, transparent 30%, #000 75%); }
.gps-l, .gps-r { position: relative; z-index: 2; padding: 44px 48px 56px; }
.gps-l { display: flex; flex-direction: column; gap: 22px; container-type: inline-size; }
.gps-r { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; isolation: isolate; }
/* The right page is printed over the art (a bright screenshot when the game has no hero): a scrim
   of the booklet's paper, lightest behind the disc, solid under the numbers and the text. */
.gps-r::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(ellipse 72% 46% at 50% 34%, color-mix(in srgb, var(--paper) 30%, transparent), transparent 100%), linear-gradient(180deg, color-mix(in srgb, var(--paper) 25%, transparent) 0%, color-mix(in srgb, var(--paper) 80%, transparent) 52%, color-mix(in srgb, var(--paper) 95%, transparent) 68%); }
.gps-folio { position: absolute; bottom: 16px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .14em; color: var(--dim); }
.gps-l .gps-folio { left: 48px; } .gps-r .gps-folio { right: 48px; }
.gps-tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
.gps-cat { color: var(--acc); margin-right: 6px; }
.gps-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--border-2); color: var(--c, var(--text-2)); }
.gps-chip::before { content: ""; width: 5px; height: 5px; background: var(--c, var(--text-2)); }
/* Breaks only between words; the size is capped so the longest word (--longest, in em) fits the column. */
.gps-title { font-weight: 900; font-stretch: 125%; font-size: min(clamp(40px, 6.4vw, 92px), calc(100cqi / var(--longest, 1))); line-height: .86; letter-spacing: -0.04em; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gps-title:focus { outline: none; }
.gps-lede { font-size: 17.5px; line-height: 1.55; color: var(--text-2); max-width: 54ch; }
.gps-ficha { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--border-2); }
.gps-ficha div { padding: 12px 14px 12px 0; border-bottom: 1px solid var(--border); }
.gps-ficha dt { font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.gps-ficha dd { margin: 4px 0 0; font-weight: 700; font-size: 15.5px; font-variant-numeric: tabular-nums; }
.gps-ficha dd small { display: block; font-family: var(--font-jetbrains-mono), monospace; font-weight: 400; font-size: 12px; color: var(--dim); }
/* Critic score: the booklet's hero stat, a seal-like ring filled to the score. */
.gps-crit { display: flex; align-items: center; gap: 18px; margin: 0; }
.gps-crit-ring { position: relative; flex: none; width: 88px; height: 88px; display: grid; place-items: center; }
.gps-crit-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; rotate: -90deg; }
.gps-crit-ring circle { fill: none; stroke-width: 6; }
.gps-crit-trk { stroke: var(--border-2); }
.gps-crit-val { stroke: var(--c); }
.gps-crit-ring b { font-weight: 900; font-stretch: 125%; font-size: 34px; line-height: 1; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; color: var(--c); }
.gps-crit p { display: flex; flex-direction: column; gap: 4px; }
.gps-crit strong { font-weight: 800; font-size: 17px; }
.gps-crit small { font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--dim); }
.gps-actions { display: flex; gap: 8px; flex-wrap: wrap; }
@media (max-width: 1000px) {
  .gps { grid-template-columns: 1fr; }
  .gps::after { display: none; }
  .gps-r { border-top: 1px dashed var(--border-2); }
  .gps-art { -webkit-mask: linear-gradient(180deg, #000 0%, #000 22%, transparent 62%); mask: linear-gradient(180deg, #000 0%, #000 22%, transparent 62%); opacity: .55; }
  .gps-art img, .gps-art svg { object-position: center top; }
}
@media (max-width: 600px) {
  .gps-l, .gps-r { padding: 28px 20px 48px; }
  .gps-l .gps-folio { left: 20px; } .gps-r .gps-folio { right: 20px; }
  .gps-ficha { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* On a phone the main buttons come right after the title, on the first screen. */
  .gps-actions { order: 3; }
  .gps-lede { order: 4; }
  .gps-crit { order: 4; }
  .gps-ficha { order: 5; }
}
`;

const PLATFORM_CHIPS: Record<string, { label: string; color: string }> = {
  PC: { label: "PC", color: "var(--pc)" },
  PLAYSTATION: { label: "PlayStation", color: "var(--ps)" },
  XBOX: { label: "Xbox", color: "var(--xbox)" },
  NINTENDO: { label: "Nintendo", color: "var(--nin)" },
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
const delay = (d: string) => ({ "--d": d }) as CSSProperties;

function Fact({ term, children, note }: { term: string; children: ReactNode; note?: string | null }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        {children}
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/**
 * Right page: disc, progress and trophies. `user` undefined = logged out; `null` progress = the
 * account never played it. Rendered as the anonymous version in the static shell.
 */
export function BookletProgress({
  profile,
  user,
  loginHref,
}: {
  profile: GameProfile;
  user?: GameUserProfile | null;
  loginHref: string;
}) {
  const progress = user?.progress ?? null;
  const { main, byPlatform } = profile.achievements;
  const disc = { hues: profile.hues, seed: profile.seed, art: profile.art.disc, name: profile.name };

  // A game without achievements: no "0", no platinum to preview. Its hours are what counts.
  if (!main) {
    const hours = progress ? Math.round(progress.playtimeMin / 60) : 0;
    return (
      <>
        <style href="tralked-game-booklet-progress" precedence="default">
          {PROGRESS_CSS}
        </style>
        <DiscProgress {...disc} pct={0} platinum={false} preview={false} label="TRALKED · DISCO 1" platLabel="TRALKED · DISCO 1">
          <div className="gpg gpg-none gp-veil" style={delay(".3s")}>
            <b>Sem conquistas</b>
            <p>
              {progress && hours > 0 ? (
                `Aqui vale o tempo jogado: suas ${fmt(hours)} h viram Vigor no seu personagem.`
              ) : user ? (
                "Aqui vale o tempo jogado: cada hora vira Vigor no seu personagem."
              ) : (
                <>
                  Aqui vale o tempo jogado: cada hora vira Vigor. <a href={loginHref}>Entre para ver as suas</a>
                </>
              )}
            </p>
          </div>
        </DiscProgress>
      </>
    );
  }

  // Played on more than one platform: tabs per platform (and "Todas"), on the best one first.
  const split = progress ? progressViews(progress) : null;
  // No progress (logged out, or never played): the game's own numbers, one platform at a time.
  const catalog = progress
    ? null
    : catalogViews(byPlatform, main, user
        ? { prefix: "Você ainda não jogou · ", link: { href: "/conta/conexoes", label: "conecte suas contas" } }
        : { link: { href: loginHref, label: "entre para ver o seu progresso" } });
  const views = split ?? catalog;
  if (views) {
    return <PlatformProgressSwitch views={views.views} initial={views.initial} {...disc} />;
  }

  const best = progress!.best;
  const completed = Boolean(progress?.completed);
  const trophies = user?.trophies ?? null;
  const left = Math.max(0, best.total - best.unlocked);
  const headline: ReactNode = (
    <>
      {fmt(best.unlocked)}
      <span>/</span>
      {fmt(best.total)}
    </>
  );
  const detail = completed
    ? `conquistas na ${PLATFORM_NAME[best.platform]} · 100% · Tralked!`
    : `conquistas na ${PLATFORM_NAME[best.platform]} · ${best.pct}% · ${left === 1 ? "falta 1" : `faltam ${fmt(left)}`} para platinar`;

  return (
    <>
      <style href="tralked-game-booklet-progress" precedence="default">
        {PROGRESS_CSS}
      </style>
      <DiscProgress
        {...disc}
        pct={best.pct}
        platinum={completed}
        label="TRALKED · DISCO 1"
        platLabel={`TRALKED! · ${best.unlocked}/${best.total}`}
      >
        <div className="gpg gp-veil" style={delay(".3s")}>
          <b>{headline}</b>
          <p>{detail}</p>
        </div>
        {trophies ? (
          <TrophyGrid
            style={delay(".38s")}
            tralked={!progress?.byPlatform.find((p) => p.platform === best.platform)?.platinumTrophy}
            label={`Seus troféus na ${PLATFORM_NAME[best.platform]}, por nível`}
            values={{ platinum: `${trophies.platinum}/${trophies.platinumOf}`, gold: fmt(trophies.gold), silver: fmt(trophies.silver), bronze: fmt(trophies.bronze) }}
          />
        ) : null}
      </DiscProgress>
    </>
  );
}

const RING = 2 * Math.PI * 41;

/** "Nota da crítica": big number in a ring filled to the score (0-100), colored by band. */
export function CriticScore({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, score));
  const color = value >= 75 ? "var(--acc)" : value >= 50 ? "var(--gold)" : "var(--text-2)";
  return (
    <div className="gps-crit gp-veil" style={{ ...delay(".24s"), "--c": color } as CSSProperties}>
      <span className="gps-crit-ring" aria-hidden="true">
        <svg viewBox="0 0 88 88">
          <circle className="gps-crit-trk" cx="44" cy="44" r="41" />
          <circle className="gps-crit-val" cx="44" cy="44" r="41" strokeDasharray={`${(RING * value) / 100} ${RING}`} />
        </svg>
        <b>{value}</b>
      </span>
      <p>
        <strong>Nota da crítica</strong>
        <span className="sr-only">: {value} de 100. </span>
        <small>média da imprensa, de 0 a 100</small>
      </p>
    </div>
  );
}

/**
 * Steam concurrent players (item 14): "now" with today's and the highest peak, or the peak alone.
 * A number equal to one already shown is not repeated ("3.972 · pico hoje 3.972 · maior pico
 * 3.972"): the note says what it is instead.
 */
export function steamPlayersNote(players: SteamPlayersView & { current: number }): string {
  const { current, todayPeak, allTimePeak } = players;
  if (allTimePeak === current) return "o maior pico medido";
  const all = `maior pico medido ${fmt(allTimePeak)}`;
  if (todayPeak === null) return all;
  if (todayPeak === current) return `pico de hoje · ${all}`;
  if (todayPeak === allTimePeak) return `pico hoje ${fmt(todayPeak)}, o maior medido`;
  return `pico hoje ${fmt(todayPeak)} · ${all}`;
}

export function SteamPlayersFact({ players }: { players: SteamPlayersView }) {
  if (players.current === null) {
    return (
      <Fact term="Maior pico na Steam" note="Medido pelo Tralked">
        {fmt(players.allTimePeak)}
      </Fact>
    );
  }
  const note = steamPlayersNote({ ...players, current: players.current });
  return (
    <Fact term="Jogando agora na Steam" note={note}>
      {fmt(players.current)}
    </Fact>
  );
}

export function BookletSpread({
  profile,
  progress,
  steamPlayers = null,
}: {
  profile: GameProfile;
  progress: ReactNode;
  /** Steam concurrent players; null for games without samples (non-Steam, or outside the sampled top). */
  steamPlayers?: SteamPlayersView | null;
}) {
  const { achievements, timeTo100, timesToBeat, guide } = profile;
  const hours = (minutes: number) => `${fmt(Math.max(1, Math.round(minutes / 60)))} h`;
  const studio = profile.developer ?? profile.publisher;
  const main = achievements.main;
  const time100 = timeTo100 ? timeTo100Label(timeTo100) : null;
  // Rushed and main story (IGDB); the 100% has its own fact, from a single source.
  const beat = [
    timesToBeat?.hastyMin ? { k: "rápido", v: hours(timesToBeat.hastyMin) } : null,
    timesToBeat?.normalMin ? { k: "história", v: hours(timesToBeat.normalMin) } : null,
  ].filter((x): x is { k: string; v: string } => x !== null);

  return (
    <section className="gps" aria-labelledby="gp-title">
      <style href="tralked-game-spread" precedence="default">
        {CSS}
      </style>
      <div className="gps-art" aria-hidden="true">
        <GameArt
          seed={profile.seed + 1}
          hues={profile.hues}
          imageUrl={profile.art.hero ?? profile.shots.find((s) => s.url)?.url ?? null}
          figure
          priority
          // Seen at 32% through a mask over about 70% of the spread: the 850-900 px CDN copy
          // (SteamGridDB's JPEG hero thumbnail, IGDB's 720p) instead of the PNG original.
          width={900}
          height={450}
        />
      </div>
      <BackdropLoop video={profile.backdrop} gameName={profile.name} />

      <div className="gps-l">
        <div className="gps-tags gp-veil" style={delay(".05s")}>
          {profile.genres.length > 0 ? <span className="gps-cat">{profile.genres.join(" · ")}</span> : null}
          {profile.platforms.map((p) => {
            const chip = PLATFORM_CHIPS[p] ?? { label: p, color: "var(--text-2)" };
            return (
              <span key={p} className="gps-chip" style={{ "--c": chip.color } as CSSProperties}>
                {chip.label}
              </span>
            );
          })}
        </div>
        <h1
          id="gp-title"
          tabIndex={-1}
          className="gps-title gp-veil"
          style={{ ...delay(".12s"), ...titleFitStyle(profile.name) }}
        >
          {profile.name}
        </h1>
        {profile.summary ? (
          <p className="gps-lede gp-veil" style={delay(".2s")}>
            {profile.summary}
          </p>
        ) : null}
        {profile.criticScore !== null ? <CriticScore score={profile.criticScore} /> : null}
        <dl className="gps-ficha gp-veil" style={delay(".28s")}>
          <Fact term="Estúdio" note={profile.publisher && profile.publisher !== studio ? profile.publisher : null}>
            {studio ?? "Não informado"}
          </Fact>
          <Fact term="Lançamento">{profile.releaseYear ?? "Não informado"}</Fact>
          {/* A fact without data is left out instead of showing a dash. */}
          {time100 ? (
            <Fact term="Tempo para 100%" note={time100.source}>
              {time100.value}
            </Fact>
          ) : null}
          {profile.steamReviews ? (
            <Fact
              term="Avaliações Steam"
              note={`${Math.round((profile.steamReviews.positive / profile.steamReviews.total) * 100)}% de ${fmt(profile.steamReviews.total)} positivas`}
            >
              {steamReviewLabel(profile.steamReviews.positive, profile.steamReviews.total)}
            </Fact>
          ) : null}
          {steamPlayers ? <SteamPlayersFact players={steamPlayers} /> : null}
          {beat.length > 0 ? (
            <Fact term="Tempo para zerar" note={`${beat.map((b) => b.k).join(" · ")} · estimativa IGDB`}>
              {beat.map((b) => b.v).join(" · ")}
            </Fact>
          ) : null}
          <Fact
            term="Conquistas"
            note={
              main
                ? [
                    `na ${PLATFORM_NAME[main.platform]}`,
                    main.legendary > 0 ? `${fmt(main.legendary)} ${main.legendary === 1 ? "lendária" : "lendárias"}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "aqui vale o tempo jogado"
            }
          >
            {main ? fmt(main.total) : "Nenhuma"}
          </Fact>
          {guide ? (
            <Fact
              term="Conquistas perdíveis"
              note={guide.missables === 0 ? "nenhuma fica para trás" : "podem ficar para trás · veja o guia"}
            >
              {guide.missables === 0 ? "Nenhuma" : fmt(guide.missables)}
            </Fact>
          ) : null}
        </dl>
        <div className="gps-actions gp-veil" style={delay(".36s")}>
          {guide ? (
            <a className="gp-btn gp-btn-acc" href={`/jogos/${profile.slug}/guia`}>
              Abrir guia 100%
            </a>
          ) : null}
          {profile.videos.length > 0 ? (
            <a className="gp-btn" href="#videos">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              Trailer
            </a>
          ) : null}
          <a className={guide ? "gp-btn" : "gp-btn gp-btn-acc"} href={`/forum/${profile.slug}`}>
            Fórum do jogo
          </a>
          <CaseReplayButton className="gp-btn" />
        </div>
        <span className="gps-folio" aria-hidden="true">
          01 · Ficha
        </span>
      </div>

      <div className="gps-r">
        {progress}
        <span className="gps-folio" aria-hidden="true">
          02 · Seu progresso
        </span>
      </div>
    </section>
  );
}
