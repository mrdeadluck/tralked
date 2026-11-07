import type { CSSProperties, ReactNode } from "react";
import { GameArt } from "@/components/art/GameArt";
import { PLATFORM_NAME, timeTo100Label, type GameProfile, type GameUserProfile } from "@/lib/queries/game-profile";
import { steamReviewLabel } from "@/lib/games/steam-reviews";
import type { SteamPlayersView } from "@/lib/queries/steam-players";
import { BackdropLoop } from "./BackdropLoop";
import { CaseReplayButton } from "./case-replay";
import { DiscProgress } from "./DiscProgress";
import { HeroTitle } from "./HeroTitle";
import { PROGRESS_CSS, TrophyGrid } from "./progress-parts";
import { achievementsFact, bestVersion, leftLabel, nounOf, onVersion, trophyWord, versionsSummary } from "./version-views";
import { VersionRows } from "./VersionRows";
import { titleFitStyle } from "./title-fit";

/*
 * The game page's hero: the game's art behind a graphite gradient, its logo (or fitted name),
 * square chips, summary and actions on the left; the visitor's disc and progress on the right
 * (passed in as `progress`, a per-visitor island). Under it, attached, the "ficha técnica": the
 * game's facts in a grid of cells. Panels are square with the 45° corner cut.
 */

const CSS = `
.gps-wrap { display: flex; flex-direction: column; gap: 2px; }
.gps { position: relative; overflow: hidden; min-height: 540px; display: grid; background: var(--bg); }
.gps-art { position: absolute; inset: 0; pointer-events: none; }
.gps-art img, .gps-art canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 70% 30%; }
.gps-art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, var(--bg) 0%, color-mix(in oklch, var(--bg) 88%, transparent) 36%, color-mix(in oklch, var(--bg) 30%, transparent) 70%, color-mix(in oklch, var(--bg) 55%, transparent)), linear-gradient(0deg, var(--bg), transparent 40%); }
.gps-in { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 30px; align-items: center; padding: 36px; }
.gps-l { display: flex; flex-direction: column; align-items: flex-start; container-type: inline-size; min-width: 0; }
.gps-r { display: flex; flex-direction: column; align-items: center; gap: 12px; }
/* Breaks only between words; the size is capped so the longest word (--longest, in em) fits the column. */
.gps-title { font-weight: 900; font-stretch: 125%; font-size: min(clamp(40px, 6vw, 84px), calc(100cqi / var(--longest, 1))); line-height: .88; letter-spacing: -0.04em; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; text-shadow: 0 4px 30px rgba(0,0,0,.6); }
.gps-title:focus { outline: none; }
/* The official logo in a fixed box: nothing moves when it loads. 620px lets very wide logos
   (Phantom Blade Zero, about 12:1) grow; logos under about 4:1 still stop at the box height. */
.gps-logo { width: min(620px, 100%); }
.gps-logo img { display: block; width: 100%; height: clamp(110px, 12vw, 170px); object-fit: contain; object-position: left center; filter: drop-shadow(0 6px 20px rgba(0,0,0,.7)); }
.gps-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 12px; }
.gps-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; background: var(--hover-2); color: var(--text-2); font-stretch: 80%; font-weight: 750; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
.gps-chip i { width: 6px; height: 6px; background: var(--c, var(--muted)); }
.gps-lede { max-width: 54ch; font-size: 16.5px; line-height: 1.5; color: var(--text-2); }
.gps-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
/* Ficha técnica, attached under the hero. */
/* Four to a row; a short last row stretches its cells, so the grid never ends in a hole. */
.gps-ficha { display: flex; flex-wrap: wrap; gap: 2px; margin: 0; }
.gps-fc { flex: 1 1 calc(25% - 2px); min-width: 220px; background: var(--surface); padding: 14px 16px; display: grid; gap: 3px; align-content: start; }
.gps-fc dt { font-stretch: 75%; font-weight: 700; font-size: 12.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.gps-fc dd { margin: 0; display: grid; gap: 3px; }
.gps-fc dd > b { font-weight: 800; font-size: 17px; font-variant-numeric: tabular-nums; }
.gps-fc small { font-size: 12.5px; color: var(--muted); }
.gps-fc .gps-crit { display: flex; align-items: center; gap: 10px; }
.gps-crit em { flex: none; width: 42px; height: 42px; display: grid; place-items: center; font-style: normal; font-weight: 900; font-stretch: 112%; font-size: 17px; font-variant-numeric: tabular-nums; background: var(--c-bg); color: var(--c-ink); }
@media (max-width: 1000px) {
  .gps-in { grid-template-columns: 1fr; padding: 28px 24px 32px; }
  .gps-art img, .gps-art canvas { object-position: center top; }
  .gps-art::after { background: linear-gradient(180deg, color-mix(in oklch, var(--bg) 45%, transparent) 0%, color-mix(in oklch, var(--bg) 80%, transparent) 30%, var(--bg) 62%); }
}
@media (max-width: 760px) { .gps-fc { flex-basis: calc(50% - 2px); min-width: 140px; } }
@media (max-width: 600px) {
  .gps-in { padding: 22px 18px 26px; }
  .gps-lede { font-size: 15.5px; }
  .gps-fc { padding: 12px; }
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
/** "A, B e C". */
const listPt = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;

function Fact({ term, children, note }: { term: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="gps-fc">
      <dt>{term}</dt>
      <dd>
        <b>{children}</b>
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/**
 * The hero's progress column: disc, progress and trophies. `user` undefined = logged out; `null` progress = the
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
  const { main } = profile.achievements;
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

  const versions = profile.versions;
  const mine = user?.versions ?? [];
  const best = bestVersion(mine);

  // The player's versions: the disc shows the best one, the rows every one, the grid the best one's tiers.
  if (best) {
    const on = onVersion(best);
    const state = best.platinum
      ? best.pct >= 100
        ? "100% · Tralked!"
        : best.nativePlatinum
          ? `${best.pct}% · com a platina`
          : `${best.pct}% · Tralked!`
      : best.pct >= 100
        ? "100% · Tralked!"
        : `${best.pct}% · ${leftLabel(best.unlocked, best.total)} para ${best.nativePlatinum ? "platinar" : "a Platina Tralked"}`;
    const which = mine.length > 1 ? ` · o disco mostra a melhor das ${mine.length} versões` : "";
    return (
      <>
        <style href="tralked-game-booklet-progress" precedence="default">
          {PROGRESS_CSS}
        </style>
        <DiscProgress
          {...disc}
          pct={best.pct}
          platinum={best.platinum || best.pct >= 100}
          label="TRALKED · DISCO 1"
          platLabel={`TRALKED! · ${best.unlocked}/${best.total}`}
        >
          <div className="gpg gp-veil" style={delay(".3s")}>
            <b>
              {fmt(best.unlocked)}
              <span>/</span>
              {fmt(best.total)}
            </b>
            <p>{`${nounOf(best, best.total)} ${on} · ${state}${which}`}</p>
          </div>
          {mine.length > 1 || best.lists.length > 1 ? (
            <div className="gpv gp-veil" style={delay(".26s")}>
              <div className="vr-cap">
                <span className="tk-lbl">Suas versões</span>
                <small>{versionsSummary(mine)}</small>
              </div>
              <VersionRows player={mine} label="Seu progresso por versão" />
            </div>
          ) : null}
          <TrophyGrid
            style={delay(".38s")}
            tralked={!best.nativePlatinum}
            label={`Seus troféus ${on}, por nível`}
            values={{
              platinum: `${best.tiersEarned.platinum}/1`,
              gold: fmt(best.tiersEarned.gold),
              silver: fmt(best.tiersEarned.silver),
              bronze: fmt(best.tiersEarned.bronze),
            }}
          />
        </DiscProgress>
      </>
    );
  }

  // No version of the player (logged out, or never played): the game's versions, unmarked.
  if (!progress) {
    const link = user ? (
      <>
        Você ainda não jogou · <a href="/conta/conexoes">conecte suas contas</a>
      </>
    ) : (
      <a href={loginHref}>Entre para ver o seu progresso</a>
    );
    const only = versions.length === 1 ? versions[0] : null;
    // A single version (or none known): its numbers and tiers, as one platform was shown before.
    const one = only ?? (versions.length === 0 ? { ...main, label: PLATFORM_NAME[main.platform] } : null);
    return (
      <>
        <style href="tralked-game-booklet-progress" precedence="default">
          {PROGRESS_CSS}
        </style>
        <DiscProgress
          {...disc}
          pct={0}
          platinum={false}
          label="TRALKED · DISCO 1"
          platLabel={`TRALKED! · ${fmt(one?.total ?? main.total)}/${fmt(one?.total ?? main.total)}`}
        >
          {one ? (
            <>
              <div className="gpg gp-veil" style={delay(".3s")}>
                <b>{fmt(one.total)}</b>
                <p>{`${nounOf(one, one.total)} ${onVersion(one)}`}</p>
              </div>
              <TrophyGrid
                style={delay(".38s")}
                tralked={!one.nativePlatinum}
                label={
                  one.nativePlatinum
                    ? `Troféus do jogo ${onVersion(one)}, por nível`
                    : `Troféus do jogo ${onVersion(one)}, por nível, mais a platina do Tralked pelos 100%`
                }
                values={{
                  platinum: one.nativePlatinum ? fmt(one.tiers.platinum) : "+1",
                  gold: fmt(one.tiers.gold),
                  silver: fmt(one.tiers.silver),
                  bronze: fmt(one.tiers.bronze),
                }}
              />
            </>
          ) : (
            <>
              <div className="gpg gp-veil" style={delay(".3s")}>
                <b>{`${versions.length} versões`}</b>
                <p>{`${trophyWord(versions)} de cada console e loja`}</p>
              </div>
              <div className="gpv gp-veil" style={delay(".26s")}>
                <VersionRows versions={versions} label={`Versões de ${profile.name}`} />
              </div>
            </>
          )}
          <p className="vr-login gp-veil" style={delay(".4s")}>
            {link}
          </p>
        </DiscProgress>
      </>
    );
  }

  // Progress on a platform whose trophy lists are not known yet: its numbers as before.
  const bestPlatform = progress.best;
  const completed = Boolean(progress.completed);
  const trophies = user?.trophies ?? null;
  const left = Math.max(0, bestPlatform.total - bestPlatform.unlocked);
  const headline: ReactNode = (
    <>
      {fmt(bestPlatform.unlocked)}
      <span>/</span>
      {fmt(bestPlatform.total)}
    </>
  );
  const detail = completed
    ? `conquistas na ${PLATFORM_NAME[bestPlatform.platform]} · 100% · Tralked!`
    : `conquistas na ${PLATFORM_NAME[bestPlatform.platform]} · ${bestPlatform.pct}% · ${left === 1 ? "falta 1" : `faltam ${fmt(left)}`} para platinar`;

  return (
    <>
      <style href="tralked-game-booklet-progress" precedence="default">
        {PROGRESS_CSS}
      </style>
      <DiscProgress
        {...disc}
        pct={bestPlatform.pct}
        platinum={completed}
        label="TRALKED · DISCO 1"
        platLabel={`TRALKED! · ${bestPlatform.unlocked}/${bestPlatform.total}`}
      >
        <div className="gpg gp-veil" style={delay(".3s")}>
          <b>{headline}</b>
          <p>{detail}</p>
        </div>
        {trophies ? (
          <TrophyGrid
            style={delay(".38s")}
            tralked={!progress.byPlatform.find((p) => p.platform === bestPlatform.platform)?.platinumTrophy}
            label={`Seus troféus na ${PLATFORM_NAME[bestPlatform.platform]}, por nível`}
            values={{ platinum: `${trophies.platinum}/${trophies.platinumOf}`, gold: fmt(trophies.gold), silver: fmt(trophies.silver), bronze: fmt(trophies.bronze) }}
          />
        ) : null}
      </DiscProgress>
    </>
  );
}

/** "Nota da crítica": the score in a square with the corner cut, lime from 75, graphite below. */
export function CriticScore({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, score));
  const style = (
    value >= 75
      ? { "--c-bg": "var(--acc)", "--c-ink": "var(--acc-ink)" }
      : { "--c-bg": "var(--hover-2)", "--c-ink": value >= 50 ? "var(--gold)" : "var(--text)" }
  ) as CSSProperties;
  return (
    <div className="gps-fc">
      <dt>Nota da crítica</dt>
      <dd className="gps-crit" style={style}>
        <em className="tk-cut-sm">{value}</em>
        <span className="sr-only">de 100. </span>
        <small>
          média da imprensa,
          <br />
          de 0 a 100
        </small>
      </dd>
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
  const platformNames = profile.platforms.map((p) => PLATFORM_CHIPS[p]?.label ?? p);
  const counts = main ? achievementsFact(profile.versions, main, achievements.byPlatform) : null;
  const studioNote = [
    profile.publisher && profile.publisher !== studio ? profile.publisher : null,
    profile.releaseYear ? `Lançamento em ${profile.releaseYear}` : null,
  ].filter(Boolean);

  return (
    <section className="gps-wrap" aria-labelledby="gp-title">
      <style href="tralked-game-spread" precedence="default">
        {CSS}
      </style>
      <div className="gps tk-cut">
        <div className="gps-art" aria-hidden="true">
          <GameArt
            seed={profile.seed + 1}
            hues={profile.hues}
            imageUrl={profile.art.hero ?? profile.shots.find((s) => s.url)?.url ?? null}
            figure
            priority
            // The hero's width at most: the CDN copy that covers it instead of the PNG original. With
            // `sizes`, phones take the 850 px JPEG and wide or dense screens an optimized copy.
            width={1280}
            height={640}
            sizes="(max-width: 1320px) 100vw, 1320px"
          />
        </div>
        <BackdropLoop video={profile.backdrop} gameName={profile.name} />

        <div className="gps-in">
          <div className="gps-l">
            <HeroTitle
              name={profile.name}
              logoUrl={profile.art.logo}
              style={{ ...delay(".12s"), ...titleFitStyle(profile.name) }}
            />
            <div className="gps-tags gp-veil" style={delay(".05s")}>
              {profile.genres.map((g) => (
                <span key={g} className="gps-chip">
                  {g}
                </span>
              ))}
              {profile.platforms.map((p) => {
                const chip = PLATFORM_CHIPS[p] ?? { label: p, color: "var(--text-2)" };
                return (
                  <span key={p} className="gps-chip" style={{ "--c": chip.color } as CSSProperties}>
                    <i aria-hidden="true" />
                    {chip.label}
                  </span>
                );
              })}
            </div>
            {profile.summary ? (
              <p className="gps-lede gp-veil" style={delay(".2s")}>
                {profile.summary}
              </p>
            ) : null}
            <div className="gps-actions gp-veil" style={delay(".28s")}>
              {guide ? (
                <a className="gp-btn gp-btn-acc tk-cut-b" href={`/jogos/${profile.slug}/guia`}>
                  Abrir guia 100%
                </a>
              ) : null}
              {profile.videos.length > 0 ? (
                <a className="gp-btn gp-btn-s" href="#videos">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Trailer
                </a>
              ) : null}
              <a className={guide ? "gp-btn" : "gp-btn gp-btn-acc tk-cut-b"} href={`/forum/${profile.slug}`}>
                Fórum do jogo
              </a>
              <CaseReplayButton className="gp-btn" />
            </div>
          </div>

          <div className="gps-r">{progress}</div>
        </div>
      </div>

      <dl className="gps-ficha gp-veil" style={delay(".36s")}>
        {profile.criticScore !== null ? <CriticScore score={profile.criticScore} /> : null}
        <Fact term="Estúdio" note={studioNote.length > 0 ? studioNote.join(" · ") : null}>
          {studio ?? "Não informado"}
        </Fact>
        {/* A fact without data is left out instead of showing a dash. */}
        {beat.length > 0 ? (
          <Fact term="Tempo para zerar" note={`${beat.map((b) => b.k).join(" · ")} · estimativa IGDB`}>
            {beat.map((b) => b.v).join(" · ")}
          </Fact>
        ) : null}
        {time100 ? (
          <Fact term="Tempo para 100%" note={time100.source}>
            {time100.value}
          </Fact>
        ) : null}
        {steamPlayers ? <SteamPlayersFact players={steamPlayers} /> : null}
        {profile.steamReviews ? (
          <Fact
            term="Avaliações Steam"
            note={`${Math.round((profile.steamReviews.positive / profile.steamReviews.total) * 100)}% de ${fmt(profile.steamReviews.total)} positivas`}
          >
            {steamReviewLabel(profile.steamReviews.positive, profile.steamReviews.total)}
          </Fact>
        ) : null}
        <Fact
          term="Conquistas"
          note={counts ? counts.note : "aqui vale o tempo jogado"}
        >
          {counts ? fmt(counts.value) : "Nenhuma"}
        </Fact>
        {guide ? (
          <Fact
            term="Conquistas perdíveis"
            note={guide.missables === 0 ? "nenhuma fica para trás" : "podem ficar para trás · veja o guia"}
          >
            {guide.missables === 0 ? "Nenhuma" : fmt(guide.missables)}
          </Fact>
        ) : null}
        {platformNames.length > 0 ? (
          <Fact term="Plataformas" note={listPt(platformNames)}>
            {fmt(platformNames.length)}
          </Fact>
        ) : null}
      </dl>
    </section>
  );
}
