// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine, type Engine } from "./engine";

/** Every default button of EmulatorJS 4.3.0-pre (`buildButtonOptions` in data/src/emulator.js). */
const UPSTREAM_BUTTONS = [
  "playPause", "play", "pause", "restart", "mute", "unmute", "settings", "fullscreen",
  "enterFullscreen", "exitFullscreen", "saveState", "loadState", "screenRecord", "gamepad", "cheat",
  "volumeSlider", "saveSavFiles", "loadSavFiles", "quickSave", "quickLoad", "screenshot",
  "cacheManager", "exitEmulation", "netplay", "diskButton", "contextMenu",
];

const w = window as unknown as Record<string, unknown>;
const SAVE_PATH = "/home/web_user/retroarch/userdata/saves/game.srm";

/** Stands in for the EmulatorJS instance loader.js would create, with an in-memory FS. */
function fakeEmulator() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  const emu = {
    started: false,
    paused: true,
    failedToStart: false,
    config: { buttonOpts: {} as Record<string, unknown> },
    play: vi.fn(() => void (emu.paused = false)),
    pause: vi.fn(() => void (emu.paused = true)),
    toggleFullscreen: vi.fn(),
    startGameError: vi.fn(),
    gameManager: {
      getState: vi.fn(() => new Uint8Array([1, 2, 3])),
      loadState: vi.fn(),
      screenshot: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
      getSaveFilePath: vi.fn(() => SAVE_PATH),
      getSaveFile: vi.fn(() => files.get(SAVE_PATH) ?? null),
      loadSaveFiles: vi.fn(() => void calls.push("loadSaveFiles")),
      FS: {
        analyzePath: (p: string) => ({ exists: files.has(p) || dirs.has(p) }),
        mkdir: (p: string) => void dirs.add(p),
        unlink: (p: string) => void files.delete(p),
        writeFile: (p: string, data: Uint8Array) => {
          calls.push(`writeFile ${p}`);
          files.set(p, data);
        },
      },
    },
  };
  return { emu, files, dirs, calls };
}

let engine: Engine | undefined;
afterEach(() => {
  engine?.destroy();
  engine = undefined;
  document.body.innerHTML = "";
});

async function create(extra: { bios?: Blob } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const handlers = { onReady: vi.fn(), onError: vi.fn(), onExit: vi.fn() };
  const rom = new File([new Uint8Array([0])], "game.sfc");
  engine = await createEngine({ container, core: "bsnes", rom, ...extra, ...handlers });
  return { engine, container, rom, handlers };
}

/** What loader.js does once emulator.min.js is imported: create the instance, then fire events. */
function boot() {
  const fake = fakeEmulator();
  w.EJS_emulator = fake.emu;
  (w.EJS_ready as () => void)();
  fake.emu.started = true;
  fake.emu.paused = false;
  (w.EJS_onGameStart as () => void)();
  return fake;
}

const loaderScripts = () =>
  [...document.querySelectorAll("script")].filter((s) => s.src.includes("/emulator/"));

describe("createEngine", () => {
  it("configures EmulatorJS with every default button hidden and the pinned data path", async () => {
    const { container, rom } = await create();

    const buttons = w.EJS_Buttons as Record<string, unknown>;
    expect(Object.keys(buttons)).toEqual(expect.arrayContaining(UPSTREAM_BUTTONS));
    expect(Object.values(buttons).every((v) => v === false)).toBe(true);
    expect(w.EJS_pathtodata).toBe("/emulator/4.3.0-pre/data/");
    expect(w.EJS_core).toBe("bsnes");
    expect(w.EJS_gameUrl).toBe(rom);
    // 4.3.0-pre crashes on a File ROM unless gameName is a string (saveInBrowserSupported).
    expect(w.EJS_gameName).toBe("game");
    expect(w.EJS_startOnLoaded).toBe(true);
    expect(w.EJS_askBeforeExit).toBe(false);
    expect(w.EJS_disableLocalStorage).toBe(true);
    // EmulatorJS takes over the element it is given, so it gets its own mount inside the container.
    const mount = document.querySelector(w.EJS_player as string);
    expect(mount?.parentElement).toBe(container);
    expect(container.attributes.length).toBe(0);
    expect("EJS_biosUrl" in w).toBe(false);

    const [script] = loaderScripts();
    expect(new URL(script.src).pathname).toBe("/emulator/4.3.0-pre/data/loader.js");
    expect(script.type).toBe("module");
  });

  it("passes the user's BIOS to the core", async () => {
    const bios = new File([new Uint8Array([9])], "scph5501.bin");
    await create({ bios });
    expect(w.EJS_biosUrl).toBe(bios);
  });

  it("refuses to start a second engine while one is running", async () => {
    await create();
    const container = document.createElement("div");
    await expect(
      createEngine({ container, core: "bsnes", rom: new Blob(), onReady() {}, onError() {}, onExit() {} }),
    ).rejects.toThrow(/already running/);
  });
});

describe("lifecycle callbacks", () => {
  it("reports ready when the game starts and exit afterwards", async () => {
    const { handlers } = await create();
    boot();
    expect(handlers.onReady).toHaveBeenCalledOnce();
    (w.EJS_onExit as () => void)();
    expect(handlers.onExit).toHaveBeenCalledOnce();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("reports an error when EmulatorJS fails to start the game", async () => {
    const { handlers } = await create();
    const fake = fakeEmulator();
    w.EJS_emulator = fake.emu;
    (w.EJS_ready as () => void)();
    (fake.emu.startGameError as unknown as (m: string) => void)("Failed to start game");
    expect(handlers.onError).toHaveBeenCalledWith(new Error("Failed to start game"));
    expect(handlers.onReady).not.toHaveBeenCalled();
  });

  it("reports an error when the loader script cannot be fetched", async () => {
    const { handlers } = await create();
    loaderScripts()[0].dispatchEvent(new Event("error"));
    expect(handlers.onError).toHaveBeenCalledOnce();
  });

  it("keeps EmulatorJS's own right-click menu closed", async () => {
    await create();
    const { emu } = boot();
    expect(emu.config.buttonOpts.rightClick).toBe(false);
  });
});

describe("Engine", () => {
  it("saveState returns the bytes from gameManager.getState()", async () => {
    const { engine } = await create();
    boot();
    expect(await engine.saveState()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("loadState hands the bytes to gameManager.loadState()", async () => {
    const { engine } = await create();
    const { emu } = boot();
    await engine.loadState(new Uint8Array([7]));
    expect(emu.gameManager.loadState).toHaveBeenCalledWith(new Uint8Array([7]));
  });

  it("writeSaveFile writes to getSaveFilePath() and then calls loadSaveFiles", async () => {
    const { engine } = await create();
    const { emu, files, dirs, calls } = boot();
    files.set(SAVE_PATH, new Uint8Array([0]));

    await engine.writeSaveFile(new Uint8Array([4, 5]));

    expect(files.get(SAVE_PATH)).toEqual(new Uint8Array([4, 5]));
    expect(dirs).toContain("/home/web_user/retroarch/userdata/saves");
    expect(calls).toEqual([`writeFile ${SAVE_PATH}`, "loadSaveFiles"]);
    expect(emu.gameManager.loadSaveFiles).toHaveBeenCalledOnce();
  });

  it("readSaveFile returns the SRAM bytes, or null when the game has none", async () => {
    const { engine } = await create();
    const { files } = boot();
    expect(await engine.readSaveFile()).toBeNull();
    files.set(SAVE_PATH, new Uint8Array([8]));
    expect(await engine.readSaveFile()).toEqual(new Uint8Array([8]));
  });

  it("screenshot returns the core's PNG as a Blob", async () => {
    const { engine } = await create();
    boot();
    const shot = await engine.screenshot();
    expect(shot.type).toBe("image/png");
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("pauses, resumes and reports whether the game is running", async () => {
    const { engine } = await create();
    expect(engine.isRunning()).toBe(false);
    const { emu } = boot();
    expect(engine.isRunning()).toBe(true);
    engine.pause();
    expect(emu.pause).toHaveBeenCalled();
    expect(engine.isRunning()).toBe(false);
    engine.resume();
    expect(engine.isRunning()).toBe(true);
    engine.setFullscreen(true);
    expect(emu.toggleFullscreen).toHaveBeenCalledWith(true);
  });

  it("rejects save calls before the game has started", async () => {
    const { engine } = await create();
    await expect(engine.saveState()).rejects.toThrow(/not started/);
  });

  it("destroy removes the injected loader script and clears the globals", async () => {
    const { engine, container, handlers } = await create();
    const tralkedOverlay = document.createElement("p");
    container.append(tralkedOverlay);
    boot();
    const mount = document.querySelector(w.EJS_player as string)!;
    mount.classList.add("ejs_parent");
    mount.append(document.createElement("canvas"));

    engine.destroy();

    expect(loaderScripts()).toEqual([]);
    expect(Object.keys(w).filter((k) => k.startsWith("EJS_"))).toEqual([]);
    expect([...container.children]).toEqual([tralkedOverlay]);
    expect(container.attributes.length).toBe(0);
    expect(engine.isRunning()).toBe(false);
    expect(() => engine.destroy()).not.toThrow();
    expect(handlers.onExit).not.toHaveBeenCalled();
  });

  it("destroy survives the non-configurable EJS_Runtime global the core script declares", async () => {
    const { engine } = await create();
    boot();
    // What a global `var EJS_Runtime` in the core's classic script looks like.
    Object.defineProperty(window, "EJS_Runtime", {
      value: () => {},
      configurable: false,
      enumerable: true,
      writable: true,
    });

    expect(() => engine.destroy()).not.toThrow();
    expect(loaderScripts()).toEqual([]);
    expect(Object.keys(w).filter((k) => k.startsWith("EJS_"))).toEqual(["EJS_Runtime"]);
  });
});
