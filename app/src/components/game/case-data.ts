import { timeTo100Label, type GameProfile } from "@/lib/queries/game-profile";
import type { SteamPlayersView } from "@/lib/queries/steam-players";

/*
 * What the sealed case prints, from the game's real data only: the booklet's rows (inside the
 * front cover) and the back cover's screenshots, summary and small facts. A row or fact without
 * data is left out; nothing is invented (no age rating, no player count the data does not have).
 */

const fmt = (n: number) => n.toLocaleString("pt-BR");
const hours = (minutes: number) => Math.max(1, Math.round(minutes / 60));

export type CaseRows = { label: string; value: string }[];

export function bookletRows(profile: GameProfile): CaseRows {
  const main = profile.achievements.main;
  const rows: CaseRows = [];
  if (main) rows.push({ label: "Conquistas", value: fmt(main.total) });
  if (profile.timeTo100) rows.push({ label: "Para os 100%", value: timeTo100Label(profile.timeTo100).value });
  if (profile.guide) rows.push({ label: "Perdíveis", value: fmt(profile.guide.missables) });
  return rows;
}

export function backCover(profile: GameProfile, steamPlayers: SteamPlayersView | null) {
  const main = profile.achievements.main;
  const beat = [profile.timesToBeat?.hastyMin, profile.timesToBeat?.normalMin].filter((m): m is number => Boolean(m));
  const facts = [
    steamPlayers
      ? steamPlayers.current !== null
        ? `${fmt(steamPlayers.current)} jogando agora`
        : `Pico de ${fmt(steamPlayers.allTimePeak)} jogadores`
      : null,
    main ? `${fmt(main.total)} ${main.total === 1 ? "conquista" : "conquistas"}` : null,
    beat.length === 2 ? `${hours(beat[0])}–${hours(beat[1])} h` : beat.length === 1 ? `${hours(beat[0])} h` : null,
    profile.criticScore !== null ? `Nota ${profile.criticScore}` : null,
  ].filter((f): f is string => f !== null);
  const shots = profile.shots.map((s) => s.url).filter((u): u is string => Boolean(u));
  return {
    // From the second screenshot on when there are enough: the first is often the disc's label.
    shots: shots.length > 3 ? shots.slice(1, 4) : shots.slice(0, 3),
    summary: profile.summary,
    facts,
    studio: profile.developer ?? profile.publisher,
    year: profile.releaseYear,
  };
}

/** The booklet's art: a screenshot (darkened by the case), else the hero or the cover. */
export function bookletArt(profile: GameProfile): string | null {
  const shots = profile.shots.map((s) => s.url).filter((u): u is string => Boolean(u));
  return shots[1] ?? shots[0] ?? profile.art.hero ?? profile.art.cover;
}
