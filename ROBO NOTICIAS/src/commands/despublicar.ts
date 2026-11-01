import { parseArgs } from "node:util";
import { alert, sendPendingAlerts } from "../alerts.js";
import { localDay } from "../clock.js";
import type { ArticleRow, Db } from "../db.js";
import type { Tralked } from "../tralked.js";
import { runIfMain } from "./run.js";

export type DespublicarArgs = {
  /** First local day (inclusive), "YYYY-MM-DD". */
  de: string;
  /** Last local day (inclusive), "YYYY-MM-DD". */
  ate: string;
  /** Only articles whose story has an item from this source id. */
  fonte?: string;
  /** Without it the command only lists. */
  confirmar: boolean;
};

export type DespublicarResult = { matched: number; archived: number; failed: number };

type Candidate = ArticleRow & { headline: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function checkDay(name: string, value: string): void {
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`--${name} deve ser uma data AAAA-MM-DD (recebido "${value}")`);
  }
}

/** Published articles (with a site id) whose local publication day is within [de, ate], oldest first. */
function candidates(db: Db, args: DespublicarArgs): Candidate[] {
  const rows = db.raw
    .prepare(
      `SELECT a.*, s.headline AS headline FROM articles a JOIN stories s ON s.id = a.story_id
       WHERE a.status = 'published' AND a.site_id IS NOT NULL AND a.published_at IS NOT NULL
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM story_items si JOIN items i ON i.id = si.item_id
           WHERE si.story_id = a.story_id AND i.source_id = ?))
       ORDER BY a.published_at, a.id`,
    )
    .all(args.fonte ?? null, args.fonte ?? null) as unknown as Candidate[];
  return rows.filter((r) => {
    const day = localDay(new Date(r.published_at!));
    return day >= args.de && day <= args.ate;
  });
}

/**
 * Bulk unpublish: lists the published articles of the period (and source) and, with `confirmar`, PATCHes
 * `{status: "archived"}` for each and marks it `archived` locally. A failed PATCH leaves the article
 * published locally and the command goes on.
 */
export async function runDespublicar(
  deps: { db: Db; tralked: Pick<Tralked, "patchArticle">; log: (line: string) => void; now?: () => Date },
  args: DespublicarArgs,
): Promise<DespublicarResult> {
  checkDay("de", args.de);
  checkDay("ate", args.ate);
  if (args.de > args.ate) throw new Error("--de deve ser anterior ou igual a --ate");

  const { db, tralked, log } = deps;
  const found = candidates(db, args);
  const scope = `${args.de} a ${args.ate}${args.fonte ? `, fonte ${args.fonte}` : ""}`;
  log(`${found.length} matéria(s) publicada(s) (${scope})`);
  for (const a of found) log(`  ${localDay(new Date(a.published_at!))}  ${a.site_id}  ${a.headline}`);

  const result: DespublicarResult = { matched: found.length, archived: 0, failed: 0 };
  if (!args.confirmar) {
    if (found.length > 0) log("Nada foi alterado. Rode de novo com --confirmar para arquivar essas matérias.");
    return result;
  }

  for (const a of found) {
    const now = deps.now?.() ?? new Date();
    try {
      await tralked.patchArticle(a.site_id!, { status: "archived" }, `robo-archive-${a.site_id}`);
      db.markArticle(a.story_id, { status: "archived" }, now);
      result.archived++;
      log(`  arquivada: ${a.site_id}`);
    } catch (error) {
      result.failed++;
      const reason = error instanceof Error ? error.message : String(error);
      log(`  FALHOU: ${a.site_id}: ${reason}`);
      alert(db, "api", `Falha ao arquivar a matéria ${a.site_id}: ${reason}`, now);
    }
  }
  log(`${result.archived} arquivada(s), ${result.failed} com falha`);
  return result;
}

/** `pnpm despublicar --de 2026-08-01 --ate 2026-08-31 [--fonte ign] [--confirmar]` */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      de: { type: "string" },
      ate: { type: "string" },
      fonte: { type: "string" },
      confirmar: { type: "boolean", default: false },
    },
  });
  if (!values.de || !values.ate) {
    throw new Error("uso: pnpm despublicar --de AAAA-MM-DD --ate AAAA-MM-DD [--fonte id] [--confirmar]");
  }
  const { opsDeps } = await import("./deps.js");
  const deps = opsDeps();
  try {
    const result = await runDespublicar(deps, {
      de: values.de,
      ate: values.ate,
      fonte: values.fonte,
      confirmar: values.confirmar === true,
    });
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await sendPendingAlerts(deps.db, deps.config, deps.fetchFn);
    deps.db.close();
  }
}

runIfMain(import.meta.url, main);
