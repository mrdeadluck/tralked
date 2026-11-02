/** One SteamGridDB image with its size (the API reports both). */
export type SgdbAsset = { url: string; width: number | null; height: number | null };

export type SgdbArt = {
  /** Portrait grid (600×900), the case cover. */
  coverUrl?: string;
  heroUrl?: string;
  logoUrl?: string;
  /** The same images with their sizes, plus the wide grid (a capsule with the logo, 920×430). */
  cover?: SgdbAsset;
  capsule?: SgdbAsset;
  hero?: SgdbAsset;
  logo?: SgdbAsset;
};

export interface SgdbApi {
  getArt(appId: number): Promise<SgdbArt>;
}
