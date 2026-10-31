export type SgdbArt = {
  coverUrl?: string;
  heroUrl?: string;
  logoUrl?: string;
};

export interface SgdbApi {
  getArt(appId: number): Promise<SgdbArt>;
}
