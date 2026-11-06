import { env } from "@/lib/env";

/**
 * Starts the GitHub Actions workers (`.github/workflows/*.yml`) from the hourly Vercel Cron
 * `workers`, with GitHub's `workflow_dispatch`. Their own `schedule:` triggers are best-effort: on
 * 02/11/2026 they went 12 h without a run and fired up to 2 h late, so most runs never happened.
 * Each workflow keeps its schedule as a fallback, skipped once the repository variable
 * DISPATCH_FROM_VERCEL is "true" (set it after the first dispatch works).
 *
 * Hours in UTC. The cron runs at :28, after the :23–:26 jobs woke the Neon database.
 */
export const GITHUB_REPO = "mrdeadluck/tralked";

export type GithubWorker = { workflow: string; due: (at: Date) => boolean };

const oddHour = (at: Date) => at.getUTCHours() % 2 === 1;
const PSN_CATALOG_HOURS = new Set([0, 6, 10, 12, 16, 18, 22]);

export const GITHUB_WORKERS: readonly GithubWorker[] = [
  // Every 2 h: first imports of PSN/Xbox/RA/Steam accounts; current players of the Steam catalog.
  { workflow: "platform-import.yml", due: oddHour },
  { workflow: "steam-players.yml", due: oddHour },
  // Every 6 h: Steam store details of the queue.
  { workflow: "steam-details.yml", due: (at) => at.getUTCHours() % 6 === 2 },
  // Daily 04:28 UTC (01:28 in Brasília): official media and Steam review totals.
  { workflow: "catalog-enrich.yml", due: (at) => at.getUTCHours() === 4 },
  // Sundays 03:28 UTC: the RetroAchievements console catalog.
  { workflow: "retro-catalog.yml", due: (at) => at.getUTCDay() === 0 && at.getUTCHours() === 3 },
  // The PSN index's slots (0, 6, 10, 12, 16, 18 and 22 h): it computes its own window from the real
  // start (psnSliceMinutes), so its 50 min from :28 still end before the next odd hour's :23 jobs.
  { workflow: "psn-catalog.yml", due: (at) => PSN_CATALOG_HOURS.has(at.getUTCHours()) },
];

export function dueWorkers(at: Date): string[] {
  return GITHUB_WORKERS.filter((w) => w.due(at)).map((w) => w.workflow);
}

export type DispatchResult = { processed: number; failed?: number; status?: "disabled"; started?: string[] };

/** Starts the workers due at `at` on `main` (their inputs take the defaults). */
export async function dispatchWorkers(
  at: Date = new Date(),
  { token = env.GITHUB_DISPATCH_TOKEN, fetcher = fetch }: { token?: string; fetcher?: typeof fetch } = {},
): Promise<DispatchResult> {
  if (!token) return { processed: 0, status: "disabled" };
  const started: string[] = [];
  let failed = 0;
  for (const workflow of dueWorkers(at)) {
    const res = await fetcher(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tralked-cron",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (res instanceof Response && res.status === 204) {
      started.push(workflow);
      continue;
    }
    failed++;
    const reason = res instanceof Response ? `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` : res.message;
    console.error(`Cron workers: could not start ${workflow}: ${reason}`);
  }
  return { processed: started.length, failed, started };
}
