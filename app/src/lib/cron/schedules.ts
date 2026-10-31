/** Jobs served by GET /api/cron/[job]. */
export const CRON_JOBS = ["catalog", "rarity", "users", "platforms", "media", "news", "notifications"] as const;
export type CronJob = (typeof CRON_JOBS)[number];

/**
 * Suggested schedules (cron syntax, UTC), in the shape of the `crons` array of vercel.json.
 * The README carries the same list ready to paste; a test keeps both in sync.
 */
export const CRON_SCHEDULES: { path: `/api/cron/${CronJob}`; schedule: string }[] = [
  { path: "/api/cron/news", schedule: "0 * * * *" },
  { path: "/api/cron/platforms", schedule: "*/15 * * * *" },
  { path: "/api/cron/users", schedule: "*/30 * * * *" },
  { path: "/api/cron/catalog", schedule: "0 3 * * *" },
  { path: "/api/cron/rarity", schedule: "30 3 * * *" },
  { path: "/api/cron/media", schedule: "0 4 * * *" },
  { path: "/api/cron/notifications", schedule: "15 5 * * *" },
];
