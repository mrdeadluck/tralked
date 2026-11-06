/**
 * Consoles playable at /jogar and the libretro cores that run them.
 *
 * Engine: EmulatorJS 4.3.0-pre (GPL-3.0), self-hosted under `public/emulator/4.3.0-pre/`.
 *   Release: https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.3.0-pre (published 2026-05-17)
 *   Asset:   https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.3.0-pre/4.3.0-pre.7z
 *   SHA-256: 0949d75fa5cff05c47e0431443dad6b65e2ebc5f1517cbb09f3d671236d3effd
 * `pnpm emulator:vendor` (scripts/emulator-vendor.ts) verifies that hash, then copies the runtime
 * and these three cores. bsnes exists only from 4.3.0-pre on (stable 4.2.3 on npm ships snes9x,
 * whose license is non-commercial), which is why the GitHub prerelease is pinned and not npm.
 *
 * Core licenses (libretro-core-info): bsnes GPLv3 (Near); mednafen_psx_hw "Beetle PSX HW" GPLv2
 * (Mednafen Team); pcsx_rearmed "PCSX ReARMed" GPLv2 (PCSX Team, notaz, Exophase).
 */

export type Console = "snes" | "psx";

export type CoreChoice = {
  primary: string;
  /** Used when the primary core cannot run, e.g. a PS1 without a valid user BIOS. */
  fallback?: string;
  /** File extensions accepted for this console, lowercase, without the dot. */
  extensions: string[];
  /** Whether the primary core needs a BIOS supplied by the user. */
  needsBios: boolean;
};

/** Folder name under `public/emulator/`; the vendor script writes the release there. */
export const EMULATOR_VERSION = "4.3.0-pre";

export const CORES: Record<Console, CoreChoice> = {
  snes: { primary: "bsnes", extensions: ["sfc", "smc"], needsBios: false },
  psx: {
    primary: "mednafen_psx_hw",
    fallback: "pcsx_rearmed",
    extensions: ["cue", "bin", "iso", "chd", "pbp"],
    needsBios: true,
  },
};

export function pickCore(console: Console, hasValidBios: boolean): string {
  const choice = CORES[console];
  if (choice.needsBios && !hasValidBios && choice.fallback) return choice.fallback;
  return choice.primary;
}
