import { walkItemKeys, walkthroughSchema, type Walkthrough } from "@/lib/content/walkthrough-schema";

/**
 * What the admin shows about a robot guide: the report the robot sent along (Guide.report) and the
 * diff of a pending update. Both read stored JSON, so nothing here trusts its shape.
 */

export type GuideReport = {
  sourcesRead: { name: string; url: string | null; ok: boolean; reason: string | null }[];
  divergences: string[];
  singleSource: string[];
  coverage: { steam: number; covered: number; steamOnly: number } | null;
  spendUsd: number | null;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The report as the admin needs it, or null when the guide has none (human guides). */
export function parseReport(value: unknown): GuideReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const sources = Array.isArray(r.sourcesRead) ? r.sourcesRead : [];
  const cov = r.coverage as Record<string, unknown> | undefined;
  const steam = num(cov?.steam);
  const covered = num(cov?.covered);
  return {
    sourcesRead: sources.flatMap((s) => {
      const x = s as Record<string, unknown>;
      return typeof x?.name === "string"
        ? [{ name: x.name, url: typeof x.url === "string" ? x.url : null, ok: x.ok !== false, reason: typeof x.reason === "string" ? x.reason : null }]
        : [];
    }),
    divergences: strings(r.divergences),
    singleSource: strings(r.singleSource),
    coverage: steam !== null && covered !== null ? { steam, covered, steamOnly: num(cov?.steamOnly) ?? 0 } : null,
    spendUsd: num(r.spendUsd),
  };
}

/** One line for the review queue: sources read, divergences, single-source facts and coverage. */
export function reportSummary(report: GuideReport | null): string | null {
  if (!report) return null;
  const read = report.sourcesRead.filter((s) => s.ok).length;
  const parts = [
    `${read} de ${report.sourcesRead.length} fontes lidas`,
    `${report.divergences.length} divergências`,
    `${report.singleSource.length} fatos com uma fonte só`,
  ];
  if (report.coverage) parts.push(`cobertura ${report.coverage.covered}/${report.coverage.steam}`);
  return parts.join(" · ");
}

const walkthroughOf = (value: unknown): Walkthrough | null => {
  const parsed = walkthroughSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const chapterKeys = (w: Walkthrough) => w.chapters.map((c) => c.key);

/**
 * Short list of what a pending update changes: chapters and items added or removed in the
 * walkthrough, plus the other fields the patch carries.
 */
export function describePending(storedWalkthrough: unknown, payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const patch = payload as Record<string, unknown>;
  const lines: string[] = [];
  const next = walkthroughOf(patch.walkthrough);
  if (next) {
    const prev = walkthroughOf(storedWalkthrough);
    const prevChapters = new Set(prev ? chapterKeys(prev) : []);
    const nextChapters = new Set(chapterKeys(next));
    const prevItems = new Set(prev ? walkItemKeys(prev) : []);
    const nextItems = new Set(walkItemKeys(next));
    const count = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)).length;
    lines.push(
      `Capítulos: +${count(nextChapters, prevChapters)} / −${count(prevChapters, nextChapters)}`,
      `Itens: +${count(nextItems, prevItems)} / −${count(prevItems, nextItems)} (item removido perde a marca dos leitores)`,
    );
  }
  const others = Object.keys(patch).filter((k) => k !== "walkthrough");
  if (others.length > 0) lines.push(`Outros campos: ${others.join(", ")}`);
  return lines;
}
