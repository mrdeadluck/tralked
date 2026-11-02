import hollowKnight from "./__fixtures__/hollow-knight.json";
import type { IgdbCatalogApi, IgdbCatalogGame, IgdbDatePrecision, IgdbReleaseDate } from "./catalog-types";
import type { IgdbGame, IgdbTimeToBeat } from "./types";

/**
 * Offline IGDB catalog (development, tests, e2e; never production: see getIgdbCatalog). A handful
 * of console classics for the catalog import, Hollow Knight (to check it is matched to the Steam
 * game, never duplicated) and a few console releases whose dates follow the clock, so the
 * "Lançamentos" card always has something in its windows. The releases are made-up titles.
 */

const DAY = 86_400;

type FixtureGame = IgdbCatalogGame & { summary?: string; genres?: string[] };

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

export const IGDB_FIXTURE_GAMES: FixtureGame[] = [
  {
    igdbId: hollowKnight.igdbId,
    name: hollowKnight.name,
    platforms: [6, 130, 48, 49],
    firstReleaseDate: hollowKnight.firstReleaseDate,
    steamAppIds: [hollowKnight.steamAppId],
    coverImageId: hollowKnight.coverImageId,
    popularity: 900,
  },
  { igdbId: 1074, name: "Super Mario 64", platforms: [4], firstReleaseDate: utc(1996, 6, 23), steamAppIds: [], popularity: 700, genres: ["Platform"] },
  { igdbId: 1029, name: "The Legend of Zelda: Ocarina of Time", platforms: [4], firstReleaseDate: utc(1998, 11, 21), steamAppIds: [], popularity: 800, genres: ["Adventure", "Role-playing (RPG)"] },
  { igdbId: 740, name: "Halo: Combat Evolved", platforms: [11, 6], firstReleaseDate: utc(2001, 11, 15), steamAppIds: [], popularity: 600, genres: ["Shooter"] },
  { igdbId: 1942, name: "The Witcher 3: Wild Hunt", platforms: [6, 48, 49, 130, 167, 169], firstReleaseDate: utc(2015, 5, 19), steamAppIds: [292030], popularity: 1500, genres: ["Role-playing (RPG)", "Adventure"] },
  { igdbId: 1020, name: "Grand Theft Auto V", platforms: [9, 12, 48, 49, 6, 167, 169], firstReleaseDate: utc(2013, 9, 17), steamAppIds: [271590], popularity: 1400, genres: ["Shooter", "Racing"] },
  { igdbId: 2155, name: "Gran Turismo", platforms: [7], firstReleaseDate: utc(1997, 12, 23), steamAppIds: [], popularity: 300, genres: ["Racing", "Simulator"] },
];

/** Upcoming / recent console releases, `offset` days from now (an exact day unless `precision` says). */
const FIXTURE_RELEASES: { id: number; game: FixtureGame; platform: number; offset: number; precision?: IgdbDatePrecision }[] = [
  { id: 900001, platform: 167, offset: -12, game: { igdbId: 990001, name: "Lâmina do Horizonte", platforms: [167, 169], steamAppIds: [], popularity: 120 } },
  { id: 900002, platform: 169, offset: -12, game: { igdbId: 990001, name: "Lâmina do Horizonte", platforms: [167, 169], steamAppIds: [], popularity: 120 } },
  { id: 900003, platform: 130, offset: -4, game: { igdbId: 990002, name: "Pequenos Guardiões do Bosque", platforms: [130], steamAppIds: [], popularity: 80 } },
  { id: 900004, platform: 167, offset: 9, game: { igdbId: 990003, name: "Crônicas da Maré Vermelha", platforms: [167], steamAppIds: [], popularity: 300 } },
  { id: 900005, platform: 169, offset: 21, game: { igdbId: 990004, name: "Estação Órbita Zero", platforms: [169, 6], steamAppIds: [], popularity: 150 } },
  { id: 900006, platform: 6, offset: 21, game: { igdbId: 990004, name: "Estação Órbita Zero", platforms: [169, 6], steamAppIds: [], popularity: 150 } },
  { id: 900007, platform: 130, offset: 45, game: { igdbId: 990005, name: "Torre dos Ventos Antigos", platforms: [130], steamAppIds: [], popularity: 60 } },
  { id: 900008, platform: 48, offset: 70, precision: "year", game: { igdbId: 990006, name: "Expedição Âmbar", platforms: [48, 167], steamAppIds: [], popularity: 40 } },
];

const strip = (g: FixtureGame): IgdbCatalogGame => ({
  igdbId: g.igdbId,
  name: g.name,
  platforms: g.platforms,
  firstReleaseDate: g.firstReleaseDate,
  steamAppIds: g.steamAppIds,
  coverImageId: g.coverImageId,
  popularity: g.popularity,
});

export function createIgdbCatalogFixture(now: () => number = Date.now): IgdbCatalogApi {
  const today = () => Math.floor(now() / 1000 / DAY) * DAY;
  return {
    async getReleaseDates({ platforms, from, to, order, popularOnly, offset, limit }) {
      const wanted = new Set(platforms);
      const rows: IgdbReleaseDate[] = FIXTURE_RELEASES.map((r) => ({
        id: r.id,
        platform: r.platform,
        date: today() + r.offset * DAY,
        precision: r.precision ?? "day",
        game: strip(r.game),
      }))
        .filter((r) => wanted.has(r.platform) && r.date >= from && r.date < to && (!popularOnly || r.game.popularity > 0))
        .sort((a, b) => (order === "desc" ? b.date - a.date : a.date - b.date) || a.id - b.id);
      return rows.slice(offset, offset + limit);
    },
    async listGames({ platforms, afterId, limit, updatedSince }) {
      if (updatedSince !== undefined) return { games: [], rawCount: 0, lastId: 0 };
      const wanted = new Set(platforms);
      const games = IGDB_FIXTURE_GAMES.filter((g) => g.igdbId > afterId && g.platforms.some((p) => wanted.has(p)))
        .sort((a, b) => a.igdbId - b.igdbId)
        .slice(0, limit)
        .map(strip);
      return { games, rawCount: games.length, lastId: games.at(-1)?.igdbId ?? 0 };
    },
    async getTimesToBeat(ids) {
      // Every fixture game gets the same made-up times: 5 h rushed, 10 h main story, 20 h for 100%.
      const known = new Set([...IGDB_FIXTURE_GAMES, ...FIXTURE_RELEASES.map((r) => r.game)].map((g) => g.igdbId));
      return new Map<number, IgdbTimeToBeat>(
        ids.filter((id) => known.has(id)).map((id) => [id, { hastily: 18_000, normally: 36_000, completely: 72_000 }]),
      );
    },
    async getGames(ids) {
      const wanted = new Set(ids);
      const all = [...IGDB_FIXTURE_GAMES, ...FIXTURE_RELEASES.map((r) => r.game)];
      const seen = new Set<number>();
      return all
        .filter((g) => wanted.has(g.igdbId) && !seen.has(g.igdbId) && seen.add(g.igdbId))
        .map<IgdbGame>((g) => ({
          igdbId: g.igdbId,
          name: g.name,
          summary: g.summary,
          releaseDate: g.firstReleaseDate !== undefined ? new Date(g.firstReleaseDate * 1000) : undefined,
          genres: g.genres ?? [],
          themes: [],
          gameModes: [],
          perspectives: [],
          keywords: [],
          coverImageId: g.coverImageId,
        }));
    },
    async findPlatformIds() {
      return [];
    },
  };
}
