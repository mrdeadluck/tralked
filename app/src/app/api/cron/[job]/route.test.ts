import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

const jobs = vi.hoisted(() => ({
  syncCatalog: vi.fn(async () => ({ processed: 3 })),
  refreshRarity: vi.fn(async () => ({ processed: 2 })),
  syncStaleUsers: vi.fn(async () => ({ processed: 1, failed: 0 })),
  syncStalePlatformAccounts: vi.fn(async () => ({ processed: 4, failed: 0 })),
  syncStaleMedia: vi.fn(async () => ({ processed: 5, failed: 0 })),
  syncExternalNews: vi.fn(async () => ({ processed: 2, failed: 0, created: 7 })),
  deleteOldNotifications: vi.fn(async () => ({ processed: 9 })),
  runHighscoresJob: vi.fn(async () => ({ processed: 37, rows: 120, pruned: 0 })),
}));
vi.mock("@/lib/highscores/job", () => ({ runHighscoresJob: jobs.runHighscoresJob }));
vi.mock("@/lib/notifications/retention", () => ({ deleteOldNotifications: jobs.deleteOldNotifications }));
vi.mock("@/lib/sync/catalog", () => ({
  syncCatalog: jobs.syncCatalog,
  refreshRarity: jobs.refreshRarity,
}));
vi.mock("@/lib/sync/user", () => ({ syncStaleUsers: jobs.syncStaleUsers }));
vi.mock("@/lib/sync/platform-user", () => ({ syncStalePlatformAccounts: jobs.syncStalePlatformAccounts }));
vi.mock("@/lib/sync/media", () => ({ syncStaleMedia: jobs.syncStaleMedia }));
vi.mock("@/lib/sync/external-news", () => ({ syncExternalNews: jobs.syncExternalNews }));

import { GET } from "./route";

const call = (job: string, authorization?: string) =>
  GET(
    new Request(`http://localhost/api/cron/${job}`, {
      headers: authorization ? { authorization } : {},
    }) as never,
    { params: Promise.resolve({ job }) },
  );

describe("GET /api/cron/[job]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers 401 without the bearer token and runs nothing", async () => {
    expect((await call("users")).status).toBe(401);
    expect((await call("users", "Bearer wrong")).status).toBe(401);
    expect((await call("users", env.CRON_SECRET)).status).toBe(401);
    expect(jobs.syncStaleUsers).not.toHaveBeenCalled();
  });

  it("answers 404 for unknown jobs", async () => {
    expect((await call("nope", `Bearer ${env.CRON_SECRET}`)).status).toBe(404);
  });

  it("answers 401 (not 404) for unknown jobs without a token", async () => {
    expect((await call("nope")).status).toBe(401);
  });

  it.each([
    ["catalog", "syncCatalog"],
    ["rarity", "refreshRarity"],
    ["users", "syncStaleUsers"],
    ["platforms", "syncStalePlatformAccounts"],
    ["media", "syncStaleMedia"],
    ["news", "syncExternalNews"],
    ["notifications", "deleteOldNotifications"],
    ["highscores", "runHighscoresJob"],
  ] as const)("runs the %s job with a valid token", async (job, fn) => {
    const res = await call(job, `Bearer ${env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job, processed: expect.any(Number) });
    expect(jobs[fn]).toHaveBeenCalledTimes(1);
  });
});
