import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_DUE, FRAME_SCOPE, type GuideProblem } from "./checker.js";
import type { GuideDb } from "./db.js";
import { MIN_CARRIED_VERSION, WRITER_CACHE_VERSION } from "./writing-cache.js";
import { addProblems, parseSavedTexts, type DraftRound, type ProblemHistory, type SavedTexts } from "./writer.js";

/**
 * Task 20: every write-and-check round is kept in the GuideDb (`drafts`): the assembled payload, the checker's
 * problems with their scope and kind, the code's repairs and notes, the internal errors and the model's texts. Nothing
 * paid for is lost: `pnpm guia -- --rascunho <pedido>` shows the last one, and a new attempt with the same writing key
 * resumes from it (writing-cache.ts keeps only approved writings). The report of each run also goes to a local file.
 */

/** A round as saved; `texts` is null when the stage gave none (a test fake). */
export type DraftInput = Omit<DraftRound, "texts"> & { texts: SavedTexts | null };

export type SavedDraft = {
  id: number;
  requestId: string;
  attempt: number;
  writingKey: string;
  /** Task 21: `writingBaseKey` of the inputs (null for drafts saved before it). */
  baseKey: string | null;
  /** Voice v2: `WRITER_CACHE_VERSION` of the writer that saved it (null for drafts saved before v7). */
  writerVersion: number | null;
  createdAt: string;
  round: number;
  ok: boolean;
  probe: boolean;
  payload: unknown;
  problems: GuideProblem[];
  repairs: GuideProblem[];
  internalErrors: string[];
  /** A probe's: the earlier failures outside its chapters, still owed (see `DraftRound.pending`). */
  pending: GuideProblem[];
  texts: SavedTexts | null;
};

type DraftRow = {
  id: number;
  request_id: string;
  attempt: number;
  writing_key: string;
  created_at: string;
  round: number;
  ok: number;
  probe: number;
  payload_json: string;
  problems_json: string;
  repairs_json: string;
  internal_errors_json: string;
  texts_json: string | null;
  pending_json: string | null;
  base_key: string | null;
  writer_version: number | null;
};

export function saveDraft(
  db: GuideDb,
  input: { requestId: string; attempt: number; writingKey: string; baseKey?: string; writerVersion?: number; draft: DraftInput; at: Date },
): void {
  const d = input.draft;
  db.raw
    .prepare(
      `INSERT INTO drafts (request_id, attempt, writing_key, created_at, round, ok, probe, payload_json, problems_json, repairs_json,
         internal_errors_json, texts_json, pending_json, base_key, writer_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.requestId,
      input.attempt,
      input.writingKey,
      input.at.toISOString(),
      d.round,
      d.ok ? 1 : 0,
      d.probe ? 1 : 0,
      JSON.stringify(d.payload),
      JSON.stringify(d.problems),
      JSON.stringify(d.repairs),
      JSON.stringify(d.internalErrors),
      d.texts ? JSON.stringify(d.texts) : null,
      JSON.stringify(d.pending),
      input.baseKey ?? null,
      input.writerVersion ?? WRITER_CACHE_VERSION,
    );
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (json === null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

function fromRow(row: DraftRow): SavedDraft {
  return {
    id: row.id,
    requestId: row.request_id,
    attempt: row.attempt,
    writingKey: row.writing_key,
    baseKey: row.base_key ?? null,
    writerVersion: row.writer_version ?? null,
    createdAt: row.created_at,
    round: row.round,
    ok: row.ok === 1,
    probe: row.probe === 1,
    payload: parse<unknown>(row.payload_json, null),
    problems: parse<GuideProblem[]>(row.problems_json, []),
    repairs: parse<GuideProblem[]>(row.repairs_json, []),
    internalErrors: parse<string[]>(row.internal_errors_json, []),
    pending: parse<GuideProblem[]>(row.pending_json, []),
    texts: parseSavedTexts(parse<unknown>(row.texts_json, null)) ?? null,
  };
}

/** The request's last draft (any round, probe or not). */
export function latestDraft(db: GuideDb, requestId: string): SavedDraft | undefined {
  const row = db.raw.prepare("SELECT * FROM drafts WHERE request_id = ? ORDER BY id DESC LIMIT 1").get(requestId) as unknown as DraftRow | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * The last draft written from the same inputs (the writing key: dossier, scope, skeleton, style, models, version), of
 * any request of the game, with texts to resume from; undefined when there is none. Its `problems` include a probe's
 * `pending` ones: everything the resumed run must still rewrite.
 */
export function resumableDraft(db: GuideDb, writingKey: string): (SavedDraft & { texts: SavedTexts }) | undefined {
  const row = db.raw.prepare("SELECT * FROM drafts WHERE writing_key = ? ORDER BY id DESC LIMIT 1").get(writingKey) as unknown as
    | DraftRow
    | undefined;
  if (!row) return undefined;
  const draft = fromRow(row);
  return draft.texts ? { ...draft, texts: draft.texts, problems: [...draft.problems, ...draft.pending] } : undefined;
}

/**
 * Task 21: the last draft of the same inputs written by another version of the writer (or with another manual): the
 * `baseKey` (or, Task 22, one of the `earlierBaseKeys` of drafts saved before the checker left it) matches, or, for a
 * draft saved before base keys, one of `earlierKeys` (writing-cache.ts `earlierDraftKeys`).
 * Its frame and every part its checker failed or still owed (problems and pending, any kind) are dropped: written
 * again. Only the job texts the checker accepted carry over, and the new checker checks each again before any is used
 * (`checagem-devida`): a rewrite only if it rejects it. Undefined when no accepted job text is left.
 * Voice v2: only a draft of writer version `MIN_CARRIED_VERSION` or later is carried: texts written in the older voice
 * are never a starting point (a full rewrite). Drafts saved before v7 have no version: `earlierBaseKeys` / `earlierKeys`
 * (the v4 and v5 drafts they find) can no longer match anything carried.
 */
export function carriedDraft(
  db: GuideDb,
  keys: { writingKey: string; baseKey: string; earlierBaseKeys?: string[]; earlierKeys?: string[] },
): (SavedDraft & { texts: SavedTexts; problems: GuideProblem[] }) | undefined {
  const bases = [keys.baseKey, ...(keys.earlierBaseKeys ?? [])];
  const earlier = keys.earlierKeys ?? [];
  const list = (values: string[]) => values.map(() => "?").join(", ") || "NULL";
  const row = db.raw
    .prepare(
      `SELECT * FROM drafts WHERE writing_key != ? AND writer_version >= ?
         AND (base_key IN (${list(bases)}) OR (base_key IS NULL AND writing_key IN (${list(earlier)})))
       ORDER BY id DESC LIMIT 1`,
    )
    .get(keys.writingKey, MIN_CARRIED_VERSION, ...bases, ...earlier) as unknown as DraftRow | undefined;
  if (!row) return undefined;
  const draft = fromRow(row);
  if (!draft.texts) return undefined;
  const failed = new Set([...draft.problems, ...draft.pending].map((p) => p.scope));
  const jobs = Object.fromEntries(Object.entries(draft.texts.jobs).filter(([id]) => id !== FRAME_SCOPE && !failed.has(id)));
  const ids = Object.keys(jobs);
  if (ids.length === 0) return undefined;
  return {
    ...draft,
    texts: { frame: null, jobs },
    problems: ids.map((id) => ({
      scope: id,
      kind: CHECK_DUE,
      text: `O trecho ${id} vem de uma versão anterior do escritor e precisa ser checado de novo.`,
    })),
  };
}

/**
 * Task 30: what the checker and the copy check already said about each part of this writing: every saved round of the
 * request with the same base key (any attempt, any writer version), oldest first. `problems`: the texts of the checker
 * and copy findings, without duplicates; `flagged`: how many rounds had a blocking problem there (each one sent the
 * part to be rewritten). A rewrite gets them all, not only the last round's (the PBZ Steam version kept bringing back
 * the problems of two rounds before).
 */
export function problemHistory(db: GuideDb, keys: { requestId: string; baseKey: string }): ProblemHistory {
  const rows = db.raw
    .prepare("SELECT problems_json FROM drafts WHERE request_id = ? AND base_key = ? ORDER BY id")
    .all(keys.requestId, keys.baseKey) as unknown as { problems_json: string }[];
  const history: ProblemHistory = new Map();
  for (const row of rows) addProblems(history, parse<GuideProblem[]>(row.problems_json, []));
  return history;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Problems grouped by kind, then scope, with counts (most frequent first); one problem per line. */
export function groupProblems(problems: GuideProblem[]): string[] {
  const lines = [plural(problems.length, "problema", "problemas")];
  const byKind = new Map<string, GuideProblem[]>();
  for (const p of problems) {
    const kind = p.kind ?? "checador";
    byKind.set(kind, [...(byKind.get(kind) ?? []), p]);
  }
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`${kind} (${list.length}):`);
    const byScope = new Map<string, string[]>();
    for (const p of list) byScope.set(p.scope, [...(byScope.get(p.scope) ?? []), p.text]);
    for (const [scope, texts] of [...byScope].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`  ${scope} (${texts.length}):`, ...texts.map((t) => `    - ${t}`));
    }
  }
  return lines;
}

/** What `pnpm guia -- --rascunho <pedido>` prints. */
export function describeDraft(d: SavedDraft): string[] {
  const jobs = d.texts ? Object.keys(d.texts.jobs).length : 0;
  return [
    `rascunho de ${d.requestId}, tentativa ${d.attempt}, rodada ${d.round}${d.probe ? " (sonda)" : ""}, ${d.createdAt}: ${d.ok ? "aprovado" : "reprovado"}`,
    `textos salvos: ${d.texts ? `moldura ${d.texts.frame ? "sim" : "não"}, ${plural(jobs, "trecho", "trechos")}` : "nenhum"}; chave ${d.writingKey}`,
    ...groupProblems(d.problems),
    ...(d.pending.length > 0 ? [`pendentes de antes, fora da sonda (${d.pending.length}):`, ...groupProblems(d.pending).slice(1).map((l) => `  ${l}`)] : []),
    ...(d.repairs.length > 0 ? [`notas e reparos do código e do checador, não bloqueiam (${d.repairs.length}):`, ...groupProblems(d.repairs).slice(1).map((l) => `  ${l}`)] : []),
    ...(d.internalErrors.length > 0 ? [`erros internos do escritor (${d.internalErrors.length}):`, ...d.internalErrors.map((e) => `  - ${e}`)] : []),
  ];
}

/** Writes a run's report to `<dir>/relatorios/<request>-<attempt>.json`; returns the path. */
export function writeReportFile(dir: string, requestId: string, attempt: number, content: unknown): string {
  const folder = join(dir, "relatorios");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${requestId.replace(/[^\w.-]+/g, "_")}-${attempt}.json`);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return path;
}
