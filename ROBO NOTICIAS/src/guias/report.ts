import type { GuideDb } from "./db.js";
import type { GuideDossier, SteamAchievement } from "./dossier.js";

/**
 * The robot's report of a request: it goes in the request's `report` (PATCH /guide-requests/{id}) and in the
 * guide's `report` (POST/PATCH /guides). The admin reads it with `parseReport` (app/src/lib/admin/guide-report.ts)
 * and the page's compat seal reads `coverage.steam` and `coverage.steamOnly`.
 */

/** A page the robot tried to read. `url` is "" for a web search that failed. */
export type SourceRead = { name: string; url: string; ok: boolean; reason?: string };

export type RobotReport = {
  sourcesRead: SourceRead[];
  /** Plain Portuguese sentences: where the sources disagree. */
  divergences: string[];
  /** Facts that only one independent source states. */
  singleSource: string[];
  /** Steam achievements; how many some source covers; how many are not on the PSN list (or there is none). */
  coverage: { steam: number; covered: number; steamOnly: number };
  /** AI spend of the request so far (every attempt), in USD. */
  spendUsd: number;
  /** The same spend by purpose ("guia-extracao", "guide-write-chapter", "websearch"...). */
  spendByPurpose: Record<string, number>;
  /** `waiting_sources`: what the completeness gate found missing. */
  missing?: string[];
  /** `failed` by the checker: the problems left after the rewrite. */
  problems?: string[];
};

export type ReportInput = {
  sourcesRead: SourceRead[];
  /** Absent when the request stopped before the dossier was built. */
  dossier?: GuideDossier;
  /** `GET /dossie?all=1` (every platform); absent when the request stopped before reading it. */
  steamList?: SteamAchievement[];
  spendUsd: number;
  spendByPurpose?: Record<string, number>;
  missing?: string[];
  problems?: string[];
};

const usd = (value: number) => Math.round(value * 1e4) / 1e4;

/** Single-source facts: achievements and scalar facts by name; items counted per chapter (they can be hundreds). */
function singleSourceFacts(d: GuideDossier): string[] {
  const out: string[] = [];
  for (const a of d.achievements) {
    if (a.sources.length === 1) out.push(`Conquista "${a.nameEn}" (${a.apiName}): só ${a.sources[0]}.`);
  }
  const scalars = [
    ["Número de jogadas", d.facts.playthroughs],
    ["Dificuldade", d.facts.difficulty],
    ["Horas", d.facts.hours],
  ] as const;
  for (const [label, scalar] of scalars) {
    if (scalar && scalar.sources.length === 1) out.push(`${label}: só ${scalar.sources[0]}.`);
  }
  for (const chapter of d.chapters) {
    const lone = chapter.items.filter((i) => i.sources.length === 1);
    if (lone.length === 0) continue;
    const names = [...new Set(lone.map((i) => i.sources[0]))].join(", ");
    out.push(`Capítulo "${chapter.title}": ${lone.length} ${lone.length === 1 ? "item" : "itens"} só em ${names}.`);
  }
  return out;
}

export function buildReport(input: ReportInput): RobotReport {
  const d = input.dossier;
  const steam = (input.steamList ?? []).filter((a) => a.platform === "steam").length;
  return {
    sourcesRead: input.sourcesRead.map((s) => ({ name: s.name, url: s.url, ok: s.ok, ...(s.reason ? { reason: s.reason } : {}) })),
    divergences: d ? [...d.divergences] : [],
    singleSource: d ? singleSourceFacts(d) : [],
    coverage: {
      steam,
      covered: d ? d.achievements.filter((a) => a.sources.length > 0).length : 0,
      steamOnly: d ? d.achievements.filter((a) => a.steamOnly).length : 0,
    },
    spendUsd: usd(input.spendUsd),
    spendByPurpose: Object.fromEntries(Object.entries(input.spendByPurpose ?? {}).map(([k, v]) => [k, usd(v)])),
    ...(input.missing ? { missing: input.missing } : {}),
    ...(input.problems ? { problems: input.problems } : {}),
  };
}

/** Spend of a request grouped by purpose; "guia-extracao:PowerPyx:1/2" and "websearch: query" group by their prefix. */
export function spendByPurpose(db: GuideDb, requestId: string): Record<string, number> {
  const rows = db.raw.prepare("SELECT purpose, usd FROM spend WHERE request_id = ?").all(requestId) as unknown as {
    purpose: string;
    usd: number;
  }[];
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.purpose.split(":")[0]!.trim();
    out[key] = (out[key] ?? 0) + row.usd;
  }
  return out;
}
