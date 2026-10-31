import { resetIgdb } from "./igdb";
import { resetRawg } from "./rawg";
import { resetSgdb } from "./sgdb";
import { resetSteam } from "./steam";

export { getSteam } from "./steam";
export { getIgdb } from "./igdb";
export { getRawg } from "./rawg";
export { getSgdb } from "./sgdb";
export { mapToSkills } from "./genre-map";
export type { SteamApi } from "./steam/types";
export type { IgdbApi, IgdbGame } from "./igdb/types";
export type { RawgApi, RawgGame } from "./rawg/types";
export type { SgdbApi, SgdbArt } from "./sgdb/types";

/** Tests only: forgets every memoized client (e.g. after changing env mocks). */
export function resetIntegrations(): void {
  resetSteam();
  resetIgdb();
  resetRawg();
  resetSgdb();
}
