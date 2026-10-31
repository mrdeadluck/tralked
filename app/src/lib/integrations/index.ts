import { resetIgdb } from "./igdb";
import { resetPsn } from "./psn";
import { resetRawg } from "./rawg";
import { resetRetro } from "./retro";
import { resetSgdb } from "./sgdb";
import { resetSteam } from "./steam";
import { resetXbox } from "./xbox";

export { getSteam } from "./steam";
export { getIgdb } from "./igdb";
export { getRawg } from "./rawg";
export { getSgdb } from "./sgdb";
export { getPsn } from "./psn";
export { getXbox } from "./xbox";
export { getRetro } from "./retro";
export { mapToSkills } from "./genre-map";
export type { SteamApi } from "./steam/types";
export type { IgdbApi, IgdbGame, IgdbMedia } from "./igdb/types";
export type { RawgApi, RawgGame } from "./rawg/types";
export type { SgdbApi, SgdbArt } from "./sgdb/types";
export type { PsnApi, PsnProfile, PsnTitle, PsnTrophy } from "./psn/types";
export type { XboxApi, XboxAchievement, XboxProfile, XboxTitle } from "./xbox/types";
export type { RetroAchievement, RetroApi, RetroGame, RetroProfile } from "./retro/types";

/** Tests only: forgets every memoized client (e.g. after changing env mocks). */
export function resetIntegrations(): void {
  resetSteam();
  resetIgdb();
  resetRawg();
  resetSgdb();
  resetPsn();
  resetXbox();
  resetRetro();
}
