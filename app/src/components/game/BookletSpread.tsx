import type { CSSProperties, ReactNode } from "react";
import { GameArt } from "@/components/art/GameArt";
import {
  PLATFORM_NAME,
  type GameProfile,
  type GameUserProfile,
  type TierCounts,
} from "@/lib/queries/game-profile";
import { steamReviewLabel } from "@/lib/games/steam-reviews";
import { BackdropLoop } from "./BackdropLoop";
import { CaseReplayButton } from "./case-replay";
import { DiscProgress } from "./DiscProgress";
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
.gps-r { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; }
.gps-folio { position: absolute; bottom: 16px; font-family: var(--font-jetbrains-mono), monospace; font-size: 10px; letter-spacing: .14em; color: var(--ph); }
.gps-l .gps-folio { left: 48px; } .gps-r .gps-folio { right: 48px; }
.gps-tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-family: var(--font-jetbrains-mono), monospace; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
.gps-cat { color: var(--acc); margin-right: 6px; }
.gps-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--border-2); color: var(--c, var(--text-2)); }
.gps-chip::before { content: ""; width: 5px; height: 5px; background: var(--c, var(--text-2)); }
/* Breaks only between words; the size is capped so the longest word (--longest, in em) fits the column. */
.gps-title { font-weight: 900; font-stretch: 125%; font-size: min(clamp(40px, 6.4vw, 92px), calc(100cqi / var(--longest, 1))); line-height: .86; letter-spacing: -0.04em; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gps-title:focus { outline: none; }
.gps-lede { font-size: 17.5px; line-height: 1.55; color: var(--text-2); max-width: 54ch; }
.gps-ficha { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--border-2); }
.gps-ficha div { padding: 12px 14px 12px 0; border-bottom: 1px solid var(--border); }
.gps-ficha dt { font-family: var(--font-jetbrains-mono), monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.gps-ficha dd { margin: 4px 0 0; font-weight: 700; font-size: 15.5px; font-variant-numeric: tabular-nums; }
.gps-ficha dd small { display: block; font-family: var(--font-jetbrains-mono), monospace; font-weight: 400; font-size: 10.5px; color: var(--dim); }
.gps-score { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 26px; padding: 0 6px; background: var(--acc); color: var(--bg); font-weight: 900; font-stretch: 112%; font-size: 15px; }
.gps-actions { display: flex; gap: 8px; flex-wrap: wrap; }
@media (max-width: 1000px) {
  .gps { grid-template-columns: 1fr; }
  .gps::after { display: none; }
  .gps-r { border-top: 1px dashed var(--border-2); }
  .gps-art { -webkit-mask: linear-gradient(180deg, #000 0%, transparent 55%); mask: linear-gradient(180deg, #000 0%, transparent 55%); opacity: .22; }
}
@media (max-width: 600px) {
  .gps-l, .gps-r { padding: 28px 20px 48px; }
  .gps-l .gps-folio { left: 20px; } .gps-r .gps-folio { right: 20px; }
  .gps-ficha { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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

const PROGRESS_CSS = `
.gpg { text-align: center; }
.gpg b { font-weight: 900; font-stretch: 125%; font-size: 44px; line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.gpg b span { color: var(--acc); }
.gpg p { font-family: var(--font-jetbrains-mono), monospace; font-size: 11.5px; color: var(--muted); margin-top: 6px; }
.gpg p a { color: var(--acc); text-decoration: underline; text-underline-offset: 3px; }
.gpg ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; font-family: var(--font-jetbrains-mono), monospace; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); }
.gpg li b { font: inherit; color: var(--text-2); letter-spacing: inherit; }
.gpt { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; width: 100%; max-width: 420px; margin: 0; padding: 0; list-style: none; background: var(--border); border: 1px solid var(--border); }
.gpt li { background: var(--paper-2); padding: 10px 6px; text-align: center; }
.gpt svg { width: 20px; height: 20px; }
.gpt b { display: block; font-weight: 900; font-stretch: 112%; font-size: 20px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.gpt small { font-family: var(--font-jetbrains-mono), monospace; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
`;

const TROPHY_UI: { tier: keyof TierCounts; label: string; color: string }[] = [
  { tier: "platinum", label: "Platina", color: "var(--plat)" },
  { tier: "gold", label: "Ouro", color: "var(--gold)" },
  { tier: "silver", label: "Prata", color: "var(--silver)" },
  { tier: "bronze", label: "Bronze", color: "var(--bronze)" },
];

function TrophyIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
    </svg>
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
  const best = progress?.best ?? null;
  const completed = Boolean(progress?.completed);
  const total = profile.achievements.steam || profile.achievements.byPlatform[0]?.total || 0;
  const trophies = user?.trophies ?? null;
  const { tiers } = profile.achievements;
  // Logged out, the grid shows the game's own trophies: skip it while the catalog has none by tier.
  const showTrophies = trophies !== null || tiers.gold + tiers.silver + tiers.bronze > 0;

  let headline: ReactNode;
  let detail: ReactNode;
  if (best) {
    const left = Math.max(0, best.total - best.unlocked);
    headline = (
      <>
        {fmt(best.unlocked)}
        <span>/</span>
        {fmt(best.total)}
      </>
    );
    detail = completed
      ? `conquistas na ${PLATFORM_NAME[best.platform]} · 100% · platinado`
      : `conquistas na ${PLATFORM_NAME[best.platform]} · ${best.pct}% · ${left === 1 ? "falta 1" : `faltam ${fmt(left)}`} para platinar`;
  } else if (user) {
    headline = (
      <>
        0<span>/</span>
        {fmt(total)}
      </>
    );
    detail = (
      <>
        Você ainda não tem progresso neste jogo. <a href="/conta/conexoes">Conecte suas contas</a>
      </>
    );
  } else {
    headline = fmt(total);
    detail = (
      <>
        conquistas · <a href={loginHref}>entre para ver o seu progresso</a>
      </>
    );
  }

  return (
    <>
      <style href="tralked-game-booklet-progress" precedence="default">
        {PROGRESS_CSS}
      </style>
      <DiscProgress
        pct={best?.pct ?? 0}
        platinum={completed}
        hues={profile.hues}
        seed={profile.seed}
        art={profile.art.disc}
        name={profile.name}
        label="TRALKED · DISCO 1"
        platLabel={best ? `PLATINADO · ${best.unlocked}/${best.total}` : "PLATINADO · 100%"}
      >
        <div className="gpg gp-veil" style={delay(".3s")}>
          <b>{headline}</b>
          <p>{detail}</p>
          {progress && progress.platforms.length > 1 ? (
            <ul aria-label="Progresso por plataforma">
              {progress.platforms.map((p) => (
                <li key={p.platform}>
                  {PLATFORM_NAME[p.platform]} <b>{p.completed ? "100%" : `${p.unlocked}/${p.total}`}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {showTrophies ? (
          <ul
            className="gpt gp-veil"
            style={delay(".38s")}
            aria-label={trophies ? "Seus troféus neste jogo, por nível" : "Troféus do jogo, por nível"}
          >
            {TROPHY_UI.map(({ tier, label, color }) => (
              <li key={tier}>
                <TrophyIcon color={color} />
                <b>
                  {trophies
                    ? tier === "platinum"
                      ? `${trophies.platinum}/${trophies.platinumOf}`
                      : fmt(trophies[tier])
                    : fmt(tiers[tier])}
                </b>
                <small>{label}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </DiscProgress>
    </>
  );
}

export function BookletSpread({ profile, progress }: { profile: GameProfile; progress: ReactNode }) {
  const { achievements, timeTo100, timesToBeat, guide } = profile;
  const hours = (minutes: number | null) => (minutes ? `${fmt(Math.max(1, Math.round(minutes / 60)))} h` : "—");
  const studio = profile.developer ?? profile.publisher;
  const otherPlatforms = achievements.byPlatform.filter((p) => p.platform !== "steam");
  const achievementsMain = achievements.steam || achievements.byPlatform[0]?.total || 0;

  return (
    <section className="gps" aria-labelledby="gp-title">
      <style href="tralked-game-spread" precedence="default">
        {CSS}
      </style>
      <div className="gps-art" aria-hidden="true">
        <GameArt seed={profile.seed + 1} hues={profile.hues} imageUrl={profile.art.hero} figure priority width={1400} height={700} />
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
        <dl className="gps-ficha gp-veil" style={delay(".28s")}>
          <Fact term="Estúdio" note={profile.publisher && profile.publisher !== studio ? profile.publisher : null}>
            {studio ?? "Não informado"}
          </Fact>
          <Fact term="Lançamento">{profile.releaseYear ?? "Não informado"}</Fact>
          <Fact term="Nota da crítica" note={profile.criticScore === null ? "Sem nota ainda" : null}>
            {profile.criticScore === null ? "—" : <span className="gps-score">{profile.criticScore}</span>}
          </Fact>
          <Fact
            term="Tempo para 100%"
            note={
              timeTo100
                ? timeTo100.players > 0
                  ? `Tempo Tralked · ${fmt(timeTo100.players)} ${timeTo100.players === 1 ? "jogador" : "jogadores"}`
                  : "Estimativa do catálogo"
                : "Ninguém completou ainda"
            }
          >
            {timeTo100 ? `${fmt(Math.max(1, Math.round(timeTo100.minutes / 60)))} h` : "—"}
          </Fact>
          {profile.steamReviews ? (
            <Fact
              term="Avaliações Steam"
              note={`${Math.round((profile.steamReviews.positive / profile.steamReviews.total) * 100)}% de ${fmt(profile.steamReviews.total)} positivas`}
            >
              {steamReviewLabel(profile.steamReviews.positive, profile.steamReviews.total)}
            </Fact>
          ) : null}
          <Fact term="Tempo para zerar" note={timesToBeat ? "Rápido · história · 100% (IGDB)" : "Sem estimativa ainda"}>
            {timesToBeat
              ? `${hours(timesToBeat.hastyMin)} · ${hours(timesToBeat.normalMin)} · ${hours(timesToBeat.completeMin)}`
              : "—"}
          </Fact>
          <Fact
            term="Conquistas"
            note={
              achievements.legendary > 0
                ? `${fmt(achievements.legendary)} ${achievements.legendary === 1 ? "lendária" : "lendárias"}`
                : otherPlatforms.length > 0
                  ? otherPlatforms.map((p) => `${p.platform.toUpperCase()} ${p.total}`).join(" · ")
                  : null
            }
          >
            {fmt(achievementsMain)}
          </Fact>
          <Fact term="Perdíveis" note={guide ? "Guia verificado" : "Guia em produção"}>
            {guide ? (guide.missables === 0 ? "Nenhuma" : fmt(guide.missables)) : "—"}
          </Fact>
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
