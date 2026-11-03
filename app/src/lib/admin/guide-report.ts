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
  /**
   * Report `scope: "psn"` (R22): the guide follows the PSN trophy list, with the report's
   * `psnCoverage` (trophies, and how many some source covers) when it has one. Absent when the guide
   * covers the whole Steam list (the default), so a Steam report reads exactly as before.
   */
  psnScope?: { total: number; covered: number } | { total: null; covered: null };
  /** Report `internalErrors`: robot bugs found while writing (its own chapter order broke the chronology check). Absent when none. */
  internalErrors?: string[];
  /**
   * Report `pendencias` (R44): the checker's objections the robot sent the guide with, for the editor to read before
   * approving (the parts they name are marked for review). Absent when none.
   */
  pendencias?: { scope: string; texto: string }[];
};

/** R44 leftovers of a stored report, whatever its shape. */
function pendenciasOf(value: unknown): { scope: string; texto: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p) => {
    const x = p as Record<string, unknown> | null;
    return x && typeof x.texto === "string" ? [{ scope: typeof x.scope === "string" ? x.scope : "", texto: x.texto }] : [];
  });
}

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
  const psn = r.psnCoverage as Record<string, unknown> | undefined;
  const psnTotal = num(psn?.total);
  const psnCovered = num(psn?.covered);
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
    ...(r.scope === "psn"
      ? { psnScope: psnTotal !== null && psnCovered !== null ? { total: psnTotal, covered: psnCovered } : { total: null, covered: null } }
      : {}),
    ...(strings(r.internalErrors).length > 0 ? { internalErrors: strings(r.internalErrors) } : {}),
    ...(pendenciasOf(r.pendencias).length > 0 ? { pendencias: pendenciasOf(r.pendencias) } : {}),
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
  if (report.psnScope) {
    const { covered, total } = report.psnScope;
    parts.push(total !== null ? `lista da PSN ${covered}/${total}` : "pela lista da PSN");
  }
  const pending = report.pendencias?.length ?? 0;
  if (pending > 0) parts.push(`${pending} ${pending === 1 ? "pendência" : "pendências"} do checador`);
  const errors = report.internalErrors?.length ?? 0;
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "erro interno" : "erros internos"} do robô`);
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
  // R44: the update went out with the checker's leftovers: say so before the editor applies it.
  const pending = pendenciasOf((patch.report as Record<string, unknown> | undefined)?.pendencias);
  if (pending.length > 0) {
    lines.push(`Pendências do checador (leia antes de aplicar): ${pending.map((p) => (p.scope ? `[${p.scope}] ${p.texto}` : p.texto)).join(" | ")}`);
  }
  const others = Object.keys(patch).filter((k) => k !== "walkthrough");
  if (others.length > 0) lines.push(`Outros campos: ${others.join(", ")}`);
  return lines;
}
