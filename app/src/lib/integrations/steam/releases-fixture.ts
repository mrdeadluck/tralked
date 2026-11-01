import type { SteamReleaseItem, SteamReleaseList } from "./releases";

/**
 * Offline Steam release lists (STEAM_MODE=fixture, the seed, tests): games from a recording of the
 * store's popular lists (October 2026), with dates moved to follow the clock so the "Lançamentos"
 * card always has something in its windows. Never used in production (see lib/sync/releases.ts).
 */
const DAY = 86_400_000;

const RECORDED: Record<SteamReleaseList, { appId: number; name: string; offset?: number; label?: string }[]> = {
  popularnew: [
    { appId: 4115450, name: "Phantom Blade Zero", offset: -3 },
    { appId: 4512150, name: "SICRUN", offset: -1 },
    { appId: 1838980, name: "Polyion", offset: -6 },
    { appId: 3571980, name: "Keymaker", offset: -9 },
    { appId: 4699020, name: "INTUS", offset: -14 },
    { appId: 4969270, name: "Jarkeeper", offset: -20 },
    { appId: 5002040, name: "Stellacore: Mining Odyssey", offset: -27 },
    // Old game in the "popular new" list (Steam lists updates there too): outside every window.
    { appId: 367520, name: "Hollow Knight", offset: -3170 },
  ],
  popularcomingsoon: [
    { appId: 3218230, name: "ArcheAge Chronicles", offset: 3 },
    { appId: 2320980, name: "Loftia", offset: 3 },
    { appId: 3629430, name: "DREADMOOR", offset: 9 },
    { appId: 2523740, name: "DreamWorks Shrek 2 Remastered", offset: 10 },
    { appId: 3669620, name: "Warhammer Survivors", offset: 10 },
    { appId: 3456660, name: "PAYDAY: Aces High", offset: 5 },
    { appId: 2870790, name: "Dumpster Gang", offset: 33 },
    { appId: 3680170, name: "Mortuus", offset: 72 },
    { appId: 3517740, name: "Frostrail", label: "4º trimestre de 2026" },
  ],
};

export function fixtureReleaseList(list: SteamReleaseList, now: number = Date.now()): SteamReleaseItem[] {
  const today = Math.floor(now / DAY) * DAY;
  return RECORDED[list].map((r, position) => ({
    appId: r.appId,
    name: r.name,
    ...(r.offset !== undefined ? { date: new Date(today + r.offset * DAY) } : { dateLabel: r.label }),
    position,
  }));
}
