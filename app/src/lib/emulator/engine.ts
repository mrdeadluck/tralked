/**
 * Typed wrapper over EmulatorJS 4.3.0-pre, self-hosted under /emulator/4.3.0-pre/ (see cores.ts
 * for the pinned release and its SHA-256). EmulatorJS only runs the game inside the container;
 * every control is Tralked UI calling this API, so all of EmulatorJS's own buttons are hidden.
 *
 * Verified against the release sources (data/loader.js, data/src/emulator.js, GameManager.js):
 * - loader.js reads the globals EJS_player (a selector), EJS_core, EJS_gameUrl, EJS_biosUrl
 *   (File/Blob accepted), EJS_pathtodata, EJS_Buttons, EJS_startOnLoaded, EJS_askBeforeExit and
 *   EJS_disableLocalStorage, creates window.EJS_emulator and subscribes EJS_ready ("ready"),
 *   EJS_onGameStart ("start") and EJS_onExit ("exit").
 * - EJS_Buttons: every key of `buildButtonOptions` set to false hides that button. `rightClick`
 *   is dropped by that merge, so it is set again on the instance's config at "ready".
 * - Start failures go through `startGameError(message)` (no event), wrapped here to report them.
 * - Instance: play(), pause(), paused, started, failedToStart, toggleFullscreen(on).
 * - gameManager: getState() -> Uint8Array, loadState(bytes), screenshot() -> Promise<PNG bytes>,
 *   getSaveFile() (flushes SRAM first) -> Uint8Array | null, getSaveFilePath(), loadSaveFiles(),
 *   FS (Emscripten). Writing a save mirrors the release's own "Import Save File" button.
 *
 * loader.js declares top-level consts, so it is injected as a module with a per-engine query:
 * a classic script could not be loaded twice in one page (e.g. a PS1 core fallback).
 */
import { EMULATOR_VERSION } from "./cores";

export type Engine = {
  pause(): void;
  resume(): void;
  isRunning(): boolean;
  saveState(): Promise<Uint8Array>;
  loadState(s: Uint8Array): Promise<void>;
  readSaveFile(): Promise<Uint8Array | null>;
  writeSaveFile(b: Uint8Array): Promise<void>;
  screenshot(): Promise<Blob>;
  setFullscreen(on: boolean): void;
  destroy(): void;
};

export type EngineOptions = {
  container: HTMLElement;
  core: string;
  /** Pass a File when possible: EmulatorJS keeps its name, which some cores use. */
  rom: Blob;
  bios?: Blob;
  onReady(): void;
  onError(e: Error): void;
  onExit(): void;
};

type EmscriptenFS = {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  unlink(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
};

type GameManager = {
  getState(): Uint8Array;
  loadState(state: Uint8Array): void;
  screenshot(): Promise<Uint8Array>;
  getSaveFile(save?: boolean): Uint8Array | null;
  getSaveFilePath(): string;
  loadSaveFiles(): void;
  FS: EmscriptenFS;
};

type EmulatorJS = {
  started: boolean;
  paused: boolean;
  failedToStart: boolean;
  config: { buttonOpts: Record<string, unknown> };
  gameManager?: GameManager;
  play(): void;
  pause(): void;
  toggleFullscreen(on: boolean): void;
  startGameError(message: string): void;
};

type EjsWindow = Window & Record<`EJS_${string}`, unknown> & { EJS_emulator?: EmulatorJS };

export const EMULATOR_DATA_PATH = `/emulator/${EMULATOR_VERSION}/data/`;

/** Default buttons of EmulatorJS 4.3.0-pre (`buildButtonOptions`), plus `rightClick`. */
const HIDDEN_BUTTONS = [
  "playPause", "play", "pause", "restart", "mute", "unmute", "settings", "fullscreen",
  "enterFullscreen", "exitFullscreen", "saveState", "loadState", "screenRecord", "gamepad", "cheat",
  "volumeSlider", "saveSavFiles", "loadSavFiles", "quickSave", "quickLoad", "screenshot",
  "cacheManager", "exitEmulation", "netplay", "diskButton", "contextMenu", "rightClick",
] as const;

const LOADER_ATTR = "data-tralked-engine-loader";
const MOUNT_ATTR = "data-tralked-engine";

let instances = 0;

export async function createEngine(opts: EngineOptions): Promise<Engine> {
  const w = window as unknown as EjsWindow;
  if (w.EJS_emulator || document.querySelector(`script[${LOADER_ATTR}]`)) {
    throw new Error("An emulator engine is already running on this page; destroy it first.");
  }

  const id = String(++instances);
  let destroyed = false;
  let failed = false;
  let ready = false;
  const fail = (e: Error) => {
    if (destroyed || failed) return;
    failed = true;
    opts.onError(e);
  };

  // EmulatorJS empties the element it is given and adds its own classes, so it gets a mount of
  // its own that fills the container; the container stays Tralked's to size and decorate.
  const mount = document.createElement("div");
  mount.setAttribute(MOUNT_ATTR, id);
  mount.style.width = "100%";
  mount.style.height = "100%";
  opts.container.append(mount);

  const globals: Record<`EJS_${string}`, unknown> = {
    EJS_player: `[${MOUNT_ATTR}="${id}"]`,
    EJS_core: opts.core,
    EJS_gameUrl: opts.rom,
    ...(opts.bios ? { EJS_biosUrl: opts.bios } : {}),
    // 4.3.0-pre calls config.gameUrl.startsWith() in saveInBrowserSupported() unless gameName is
    // a string, which throws for a File ROM. A fixed name keeps the file's real name out of it.
    EJS_gameName: "game",
    EJS_pathtodata: EMULATOR_DATA_PATH,
    EJS_Buttons: Object.fromEntries(HIDDEN_BUTTONS.map((key) => [key, false])),
    EJS_startOnLoaded: true,
    EJS_askBeforeExit: false,
    EJS_disableLocalStorage: true,
    EJS_ready: () => {
      const emu = w.EJS_emulator;
      if (!emu) return;
      emu.config.buttonOpts.rightClick = false;
      const startGameError = emu.startGameError.bind(emu);
      emu.startGameError = (message: string) => {
        startGameError(message);
        fail(new Error(message));
      };
      if (emu.failedToStart) fail(new Error("EmulatorJS failed to start the game."));
    },
    EJS_onGameStart: () => {
      if (destroyed || failed) return;
      ready = true;
      opts.onReady();
    },
    EJS_onExit: () => {
      if (!destroyed && ready) opts.onExit();
    },
  };
  Object.assign(w, globals);

  const script = document.createElement("script");
  script.type = "module";
  script.src = `${EMULATOR_DATA_PATH}loader.js?engine=${id}`;
  script.setAttribute(LOADER_ATTR, id);
  script.addEventListener("error", () => fail(new Error("Could not load the emulator engine.")));
  document.body.append(script);

  const gameManager = (): GameManager => {
    const gm = w.EJS_emulator?.started ? w.EJS_emulator.gameManager : undefined;
    if (destroyed || !gm) throw new Error("The game has not started yet.");
    return gm;
  };

  return {
    pause: () => w.EJS_emulator?.pause(),
    resume: () => w.EJS_emulator?.play(),
    isRunning: () => !destroyed && !!w.EJS_emulator?.started && !w.EJS_emulator.paused,
    saveState: async () => new Uint8Array(gameManager().getState()),
    loadState: async (state) => gameManager().loadState(state),
    readSaveFile: async () => gameManager().getSaveFile() ?? null,
    writeSaveFile: async (bytes) => {
      const gm = gameManager();
      const path = gm.getSaveFilePath();
      let dir = "";
      for (const part of path.split("/").slice(0, -1).filter(Boolean)) {
        dir += `/${part}`;
        if (!gm.FS.analyzePath(dir).exists) gm.FS.mkdir(dir);
      }
      if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
      gm.FS.writeFile(path, bytes);
      gm.loadSaveFiles();
    },
    screenshot: async () => {
      const png = await gameManager().screenshot();
      return new Blob([new Uint8Array(png)], { type: "image/png" });
    },
    setFullscreen: (on) => w.EJS_emulator?.toggleFullscreen(on),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      try {
        if (w.EJS_emulator?.started) w.EJS_emulator.pause();
      } catch {
        // The instance may be half-initialised; tearing down the page state is what matters.
      }
      script.remove();
      mount.remove();
      // Reflect.deleteProperty, unlike `delete` in strict mode, does not throw on the core's
      // non-configurable `var EJS_Runtime`; that one is replaced by the next core script anyway.
      for (const key of Object.keys(w)) {
        if (key.startsWith("EJS_")) Reflect.deleteProperty(w, key);
      }
    },
  };
}
