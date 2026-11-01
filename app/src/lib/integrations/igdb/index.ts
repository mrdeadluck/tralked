import { env, hasKey } from "@/lib/env";
import { fixturesAllowed } from "../availability";
import { createIgdbCatalogFixture } from "./catalog-fixture";
import type { IgdbCatalogApi } from "./catalog-types";
import { createIgdbClient } from "./client";
import { createIgdbFixture } from "./fixture";
import type { IgdbApi } from "./types";

export type * from "./types";
export type * from "./catalog-types";

let real: ReturnType<typeof createIgdbClient> | undefined;
let instance: IgdbApi | undefined;

/** Both Twitch credentials are set. */
export function igdbConfigured(): boolean {
  return hasKey("IGDB_CLIENT_ID") && Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET);
}

/** One real client per process: its token cache and rate limiter are shared by every caller. */
function realClient() {
  real ??= createIgdbClient({ clientId: env.IGDB_CLIENT_ID!, clientSecret: env.IGDB_CLIENT_SECRET! });
  return real;
}

/**
 * Real IGDB client when Twitch credentials are set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one client (and its token cache / rate limiter).
 */
export function getIgdb(): IgdbApi {
  instance ??= igdbConfigured() ? realClient() : createIgdbFixture();
  return instance;
}

/**
 * IGDB for the releases job and the console catalog import. Without the credentials: the offline
 * fixture where fixtures are allowed (development, tests), and null in production, where those
 * parts are off (the pages say so) instead of showing made-up releases.
 */
export function getIgdbCatalog(): IgdbCatalogApi | null {
  if (igdbConfigured()) return realClient();
  return fixturesAllowed() ? createIgdbCatalogFixture() : null;
}

/** The releases/catalog part of IGDB is on (real credentials, or fixtures outside production). */
export function igdbCatalogAvailable(): boolean {
  return igdbConfigured() || fixturesAllowed();
}

/** Tests only: forgets the memoized client. */
export function resetIgdb(): void {
  instance = undefined;
  real = undefined;
}
