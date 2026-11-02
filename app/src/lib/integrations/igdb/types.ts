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
  timeToBeatHastySec?: number;
  timeToBeatNormalSec?: number;
};

/** IGDB `game_time_to_beats` of one game, in seconds (each may be missing). */
export type IgdbTimeToBeat = { hastily?: number; normally?: number; completely?: number };

export type IgdbImage = { imageId: string; width: number | null; height: number | null };

/** Official media of a game: YouTube trailers, screenshots and artworks. */
export type IgdbMedia = {
  videos: { youtubeId: string; name: string | null }[];
  screenshots: IgdbImage[];
  artworks: IgdbImage[];
};

export interface IgdbApi {
  findBySteamAppId(appId: number): Promise<IgdbGame | null>;
  /** The game whose name matches exactly (after normalization), or null. */
  findByName(name: string): Promise<IgdbGame | null>;
  getMedia(igdbId: number): Promise<IgdbMedia>;
}
