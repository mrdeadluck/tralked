export type IgdbGame = {
  igdbId: number;
  name: string;
  summary?: string;
  releaseDate?: Date;
  genres: string[];
  themes: string[];
  gameModes: string[];
  perspectives: string[];
  keywords: string[];
  aggregatedRating?: number;
  coverImageId?: string;
  timeToBeatCompleteSec?: number;
};

export interface IgdbApi {
  findBySteamAppId(appId: number): Promise<IgdbGame | null>;
}
