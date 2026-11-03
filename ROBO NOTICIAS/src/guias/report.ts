import type { GuideScope } from "./contract.js";
import type { GuideDb } from "./db.js";
import type { CorroborationOnly, GuideDossier, SteamAchievement } from "./dossier.js";

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
  /** The list the guide covers: the whole Steam list, or the PSN trophy list (R22); null when neither gate passed. */
  scope: GuideScope | null;
  /** Scope psn: PSN trophies (platinum included) and how many some source covers (the platinum once all others are). */
  psnCoverage?: { total: number; covered: number };
  /** AI spend of the request so far (every attempt), in USD. */
  spendUsd: number;
  /** The same spend by purpose ("guia-extracao", "guide-write-chapter", "websearch"...). */
  spendByPurpose: Record<string, number>;
  /** `waiting_sources`: what the completeness gate found missing. */
  missing?: string[];
  /** `failed` by the checker: the problems left after the rewrite. */
  problems?: string[];
  /** Robot bugs found while writing (the code's own chapter order broke the chronology check). */
  internalErrors?: string[];
  /** What the robot left out to deliver the guide (images or soundtrack after the deadline or the spend cap, ...). */
  notes?: string[];
  /**
   * R30: items only secondary sources list, matching no item of the route: never placed in the guide (no invented
   * position), listed here with what the source says (missable, until when, come back later, counts toward).
   */
  unplaced?: { title: typeof UNPLACED_TITLE; items: UnplacedItem[]; /** Cut to fit the 1 MiB body. */ omitted?: number };
  /** Items the primary script names only in its roadmap stages and that match no item of the route. */
  stageOnly?: { title: typeof STAGE_ONLY_TITLE; items: UnplacedItem[] };
};

export const STAGE_ONLY_TITLE = "Itens citados só nas etapas do roadmap do roteiro principal, não posicionados";

export const UNPLACED_TITLE = "Itens só de fonte secundária, não posicionados";
export type UnplacedItem = Omit<CorroborationOnly, "kind" | "collectibleType">;

export type ReportInput = {
  sourcesRead: SourceRead[];
  /** Absent when the request stopped before the dossier was built. */
  dossier?: GuideDossier;
  /** `GET /dossie?all=1` (every platform); absent when the request stopped before reading it. */
  steamList?: SteamAchievement[];
  spendUsd: number;
  spendByPurpose?: Record<string, number>;
  /** Absent = "steam"; null = no scope chosen (both gates failed). */
  scope?: GuideScope | null;
  missing?: string[];
  problems?: string[];
  internalErrors?: string[];
  notes?: string[];
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

/** PSN trophies some source covers: every matched trophy with a source, and the platinum once all of them are. */
function psnCoverage(d: GuideDossier): { total: number; covered: number } | undefined {
  const list = d.facts.psnList;
  if (!list) return undefined;
  const sourced = new Set(d.achievements.filter((a) => a.sources.length > 0).map((a) => a.apiName));
  const trophies = list.matches.filter((m) => !m.platinum);
  const covered = trophies.filter((m) => m.apiName && sourced.has(m.apiName)).length;
  const platinum = list.matches.length - trophies.length;
  return { total: list.total, covered: covered + (covered === trophies.length ? platinum : 0) };
}

export function buildReport(input: ReportInput): RobotReport {
  const d = input.dossier;
  const steam = (input.steamList ?? []).filter((a) => a.platform === "steam").length;
  const scope = input.scope === undefined ? "steam" : input.scope;
  const psn = scope === "psn" && d ? psnCoverage(d) : undefined;
  return {
    sourcesRead: input.sourcesRead.map((s) => ({ name: s.name, url: s.url, ok: s.ok, ...(s.reason ? { reason: s.reason } : {}) })),
    divergences: d ? [...d.divergences] : [],
    singleSource: d ? singleSourceFacts(d) : [],
    coverage: {
      steam,
      covered: d ? d.achievements.filter((a) => a.sources.length > 0).length : 0,
      steamOnly: d ? d.achievements.filter((a) => a.steamOnly).length : 0,
    },
    scope,
    ...(psn ? { psnCoverage: psn } : {}),
    spendUsd: usd(input.spendUsd),
    spendByPurpose: Object.fromEntries(Object.entries(input.spendByPurpose ?? {}).map(([k, v]) => [k, usd(v)])),
    ...(input.missing ? { missing: input.missing } : {}),
    ...(input.problems ? { problems: input.problems } : {}),
    ...(input.internalErrors?.length ? { internalErrors: input.internalErrors } : {}),
    ...(input.notes?.length ? { notes: [...input.notes] } : {}),
    ...(d && (d.corroborationOnly ?? []).length > 0 ? { unplaced: { title: UNPLACED_TITLE, items: d.corroborationOnly.map(unplacedItem) } } : {}),
    ...(d && (d.stageOnly ?? []).length > 0 ? { stageOnly: { title: STAGE_ONLY_TITLE, items: d.stageOnly.map(unplacedItem) } } : {}),
  };
}

function unplacedItem(c: CorroborationOnly): UnplacedItem {
  const { kind: _kind, collectibleType: _type, ...rest } = c;
  return rest;
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
