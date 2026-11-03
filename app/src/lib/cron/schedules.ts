/** Jobs served by GET /api/cron/[job]. */
export const CRON_JOBS = [
  "catalog",
  "rarity",
  "users",
  "platforms",
  "media",
  "news",
  "notifications",
  "steam-catalog",
  "releases",
  "igdb-catalog",
  "highscores",
  "workers",
] as const;
export type CronJob = (typeof CRON_JOBS)[number];

/**
 * The production schedules (cron syntax, UTC): app/vercel.json carries exactly this list (Vercel
 * Cron calls each route with `Authorization: Bearer $CRON_SECRET`), and so does the README; a test
 * keeps the three in sync. Same cadence the GitHub Actions schedule had (its schedules were
 * best-effort and went silent for 12 h on 02/11/2026), one minute apart so the jobs of a slot run
 * one after another (each stops at 50 s). The workers on GitHub Actions start right after the
 * :23 slot, while the Neon database is awake (README, "Workers no GitHub Actions").
 */
export const CRON_SCHEDULES: { path: `/api/cron/${CronJob}`; schedule: string }[] = [
  // Every 6 h: libraries, achievements and hours; releases; media.
  { path: "/api/cron/users", schedule: "17 */6 * * *" },
  { path: "/api/cron/releases", schedule: "18 */6 * * *" },
  { path: "/api/cron/media", schedule: "19 */6 * * *" },
  // Every 2 h (odd hours): Steam catalog, press news, PSN/Xbox/RA accounts, IGDB console catalog.
  { path: "/api/cron/steam-catalog", schedule: "23 1-23/2 * * *" },
  { path: "/api/cron/news", schedule: "24 1-23/2 * * *" },
  { path: "/api/cron/platforms", schedule: "25 1-23/2 * * *" },
  { path: "/api/cron/igdb-catalog", schedule: "26 1-23/2 * * *" },
  // Daily: catalog, rarity, highscores snapshot, notifications.
  { path: "/api/cron/catalog", schedule: "19 3 * * *" },
  { path: "/api/cron/rarity", schedule: "20 3 * * *" },
  { path: "/api/cron/highscores", schedule: "21 3 * * *" },
  { path: "/api/cron/notifications", schedule: "22 3 * * *" },
  // Hourly at :28: starts the GitHub Actions workers due that hour (lib/cron/workers.ts).
  { path: "/api/cron/workers", schedule: "28 * * * *" },
];
