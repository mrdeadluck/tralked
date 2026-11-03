import { createCall, TralkedError } from "../tralked-http.js";
import type { Dossier, GameMedia } from "../tralked.js";
import type { GuidePayloadV2 } from "./contract.js";

export type GuideRequest = { id: string; steamAppId: number; gameSlug: string; attempts: number };

export type GuideRequestReport = {
  status: string;
  reason?: string;
  report?: unknown;
  guideId?: string;
};

/** One hit of `GET /api/v1/games?steamAppId=`. */
export type GameSearchHit = {
  id: string;
  slug: string;
  name: string;
  steamAppId: number | null;
  igdbId: number | null;
  aliases: string[];
  guide: { id: string; status: string; source: string | null } | null;
};

/** A guide already on the air answers a PATCH with 202 and a pending review instead of changing. */
export type GuideWriteResult = { id: string; status?: string; pendingId?: string; [key: string]: unknown };

export type GuideApi = {
  /** Claims the next waiting request; null when there is none (204). */
  claimNext(): Promise<GuideRequest | null>;
  reportRequest(id: string, body: GuideRequestReport, idempotencyKey: string): Promise<void>;
  /** Every Steam achievement of the game, hidden ones included (`?all=1`). */
  dossier(slug: string): Promise<Dossier | null>;
  media(slug: string): Promise<GameMedia | null>;
  uploadImage(
    bytes: Uint8Array,
    contentType: "image/png" | "image/jpeg" | "image/webp",
    idempotencyKey: string,
  ): Promise<{ url: string; width?: number; height?: number }>;
  createGuide(payload: GuidePayloadV2, idempotencyKey: string): Promise<GuideWriteResult>;
  patchGuide(id: string, patch: Partial<GuidePayloadV2>, idempotencyKey: string): Promise<GuideWriteResult>;
  findGameByAppId(appId: number): Promise<GameSearchHit | null>;
};

export function createGuideApi(options: { baseUrl: string; key: string; fetchFn?: typeof fetch }): GuideApi {
  const call = createCall(options);
  const json = async <T>(response: Response) => (await response.json()) as T;

  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await json<T>(await call("GET", path));
    } catch (error) {
      if (error instanceof TralkedError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    async claimNext() {
      const response = await call("POST", "/api/v1/guide-requests/next");
      if (response.status === 204) return null;
      return (await json<{ request: GuideRequest }>(response)).request;
    },

    async reportRequest(id, body, idempotencyKey) {
      await call("PATCH", `/api/v1/guide-requests/${encodeURIComponent(id)}`, { body, idempotencyKey });
    },

    dossier: (slug) => getOrNull<Dossier>(`/api/v1/games/${encodeURIComponent(slug)}/dossie?all=1`),

    media: (slug) => getOrNull<GameMedia>(`/api/v1/games/${encodeURIComponent(slug)}/media`),

    async uploadImage(bytes, contentType, idempotencyKey) {
      const response = await call("POST", "/api/v1/media", { raw: { bytes, contentType }, idempotencyKey });
      return json(response);
    },

    async createGuide(payload, idempotencyKey) {
      return json(await call("POST", "/api/v1/guides", { body: payload, idempotencyKey }));
    },

    async patchGuide(id, patch, idempotencyKey) {
      return json(await call("PATCH", `/api/v1/guides/${encodeURIComponent(id)}`, { body: patch, idempotencyKey }));
    },

    async findGameByAppId(appId) {
      const result = await json<{ games: GameSearchHit[] }>(await call("GET", `/api/v1/games?steamAppId=${appId}`));
      return result.games[0] ?? null;
    },
  };
}
