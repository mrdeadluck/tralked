import { parseArgs } from "node:util";
import { sendPendingAlerts } from "../alerts.js";
import { runPublica } from "../pipeline.js";
import { runIfMain } from "./run.js";

export const PUBLICA_USAGE = "uso: pnpm publica [--agora] [--fora-do-horario] [--ignorar-limite]";

export type PublicaFlags = { agora: boolean; foraDoHorario: boolean; ignorarLimite: boolean };

/**
 * The flags of `pnpm publica`. Unknown flags throw (a typo must not publish with the wrong rules).
 * - `--agora`: skip the 0–12 min jitter (manual run).
 * - `--fora-do-horario`: publish even outside SLOT_FIRST_HOUR–SLOT_LAST_HOUR; implies `--agora`.
 * - `--ignorar-limite`: also skip MAX_PER_DAY and the one-per-hour rule. The daily budget always applies.
 */
export function parsePublicaArgs(args: string[]): PublicaFlags {
  const { values } = parseArgs({
    args,
    options: {
      agora: { type: "boolean", default: false },
      "fora-do-horario": { type: "boolean", default: false },
      "ignorar-limite": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const foraDoHorario = values["fora-do-horario"] === true;
  return { agora: values.agora === true || foraDoHorario, foraDoHorario, ignorarLimite: values["ignorar-limite"] === true };
}

/** `pnpm publica [--agora] [--fora-do-horario] [--ignorar-limite]`: hourly 06–23 (São Paulo) from the scheduler. */
async function main(): Promise<void> {
  let flags: PublicaFlags;
  try {
    flags = parsePublicaArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${PUBLICA_USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { realDeps } = await import("./deps.js");
  const deps = realDeps();
  try {
    const result = await runPublica({
      ...deps,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      rand: Math.random,
      ...flags,
    });
    const outcome = result.published ? `publicada ${result.published}` : "nada publicado";
    console.log(`publica ${new Date().toISOString()}: ${outcome} (${result.reason})`);
  } finally {
    await sendPendingAlerts(deps.db, deps.config, deps.fetchFn);
    deps.db.close();
  }
}

runIfMain(import.meta.url, main);
