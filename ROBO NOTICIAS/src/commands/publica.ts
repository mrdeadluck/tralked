import { runPublica } from "../pipeline.js";
import { realDeps } from "./deps.js";

/** `pnpm publica [--agora]`: hourly 06–23 (São Paulo). `--agora` skips the 0–12 min jitter (manual runs). */
async function main(): Promise<void> {
  const deps = realDeps();
  try {
    const result = await runPublica({
      ...deps,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      rand: Math.random,
      agora: process.argv.includes("--agora"),
    });
    const outcome = result.published ? `publicada ${result.published}` : "nada publicado";
    console.log(`publica ${new Date().toISOString()}: ${outcome} (${result.reason})`);
  } finally {
    deps.db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
