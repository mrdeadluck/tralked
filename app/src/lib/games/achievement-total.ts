/**
 * How many achievements a game has on a platform: the one count of the game page (ficha, disc,
 * trophy grid), the guide ("Mostrando 27 de 63") and the players' progress. Steam's is the
 * catalog's upstream count (`Game.achievementCount`, from Steam's schema) when it has one; the
 * stored rows may be partial or keep an achievement Steam no longer lists. Other platforms count
 * their stored rows. The Tralked platinum of a 100% is a reward, never one of these.
 */
export function achievementTotal(platform: string, steamCount: number, rowCount: number): number {
  return platform === "steam" && steamCount > 0 ? steamCount : rowCount;
}
