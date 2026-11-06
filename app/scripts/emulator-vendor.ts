/**
 * Copies the pinned EmulatorJS release (runtime + the cores in src/lib/emulator/cores.ts) into
 * public/emulator/<version>/ and writes LICENSES.json. Runs after `prisma generate` in postinstall;
 * when the folder already matches the pinned release it does nothing and needs no network.
 *
 *   pnpm emulator:vendor
 */
import { fileURLToPath } from "node:url";
import { vendorEmulator } from "./lib/emulator-vendor";

try {
  await vendorEmulator({ appDir: fileURLToPath(new URL("..", import.meta.url)) });
} catch (e) {
  console.error(`emulator:vendor failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
