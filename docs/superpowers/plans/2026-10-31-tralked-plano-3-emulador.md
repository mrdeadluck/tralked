# Tralked Plano 3 — Emulador Web (SNES + PS1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-in users play their own SNES and PS1 games in the browser at `/jogar`, with a Tralked-branded player, cloud saves (10 versions, conflict screen), sessions ("jogando agora", session summary), playtime XP and emulator badges.

**Architecture:** EmulatorJS (GPL-3.0, pinned, self-hosted under `public/emulator/<version>/`) runs only as an engine inside a canvas; all UI around it is Tralked React. ROM and BIOS never leave the device: the browser hashes them (RetroAchievements-compatible hashes), keeps them in IndexedDB and sends only the hash. The server keeps catalog matches, saves (Postgres, private), sessions, ledger XP and badges, behind `/api/emulador/*` route handlers that require the Tralked session.

**Tech Stack:** Next 16 (App Router, cacheComponents), Prisma 7 + Postgres, EmulatorJS (`@emulatorjs/emulatorjs` + `@emulatorjs/core-bsnes`, `@emulatorjs/core-mednafen_psx_hw`, `@emulatorjs/core-pcsx_rearmed`, exact versions pinned), IndexedDB, Web Crypto / a small MD5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-emulador-web-plano-lucas.pdf` (Lucas's plan, 9 pages). Text extraction for reading: run `python -c "import pypdf; ..."` or read the PDF directly. Builds on `docs/superpowers/specs/2026-10-31-tralked-login-proprio-design.md` (Tralked-owned login must be merged first).

## Controller decisions (not from the spec; flagged to Lucas at hand-off)

- **D1 Scope v1** (spec "Decisão pendente" option 1 + roadmap): SNES = bsnes; PS1 = Beetle PSX HW (`mednafen_psx_hw`, user BIOS) with PCSX ReARMed fallback when the user has no BIOS. Out of v1: Mega Drive, homebrews (no authorization yet), avatar items (no avatar-item system exists), in-player rcheevos and hardcore (spec puts both after the beta) — so no live achievement toast inside the player; the session summary counts RA unlocks found by an RA sync of that game run at session end —, weekly retro missions, subdomain `play.` and Sentry (deploy phase, Plano 4).
- **D2 Route** `/jogar` on the same domain; menu label "Jogar".
- **D3 Saves** in Postgres (`bytea`, gzip), never in public storage: SRAM/memory card ≤ 512 KB, save state ≤ 8 MB (after gzip), thumbnail WebP ≤ 64 KB; last 10 versions per (user, game, kind, slot). Moving to R2/S3 private buckets is Plano 4.
- **D4 XP scale**: the spec's XP numbers are in its own unit; 1 spec XP = 300 Tralked XP (anchored on "softcore 5" ↔ the site's minimum achievement XP 1500). Playtime: 600 XP per full 30 min of active play, cap 6000/day. First session on each console: 7500 XP, once per console. RetroAchievements unlocks keep paying through the existing RA account sync (spec "Etapa 1", already live) — the player does not pay achievements itself in v1.
- **D5 Identification**: RetroAchievements hash methods (SNES: MD5 of the ROM without a 512-byte copier header; PS1: RA's disc method — MD5 over the boot executable path from `SYSTEM.CNF` plus the executable bytes). Hash→game table imported from the RA API (`API_GetGameHashes` / game list with hashes) by a script + weekly cron; fixtures in dev/test. An unrecognized ROM is still playable (saves keyed by hash), but earns no XP.
- **D6 Active play** = tab visible, engine running, and keyboard/gamepad/touch input in the last 5 minutes. The client sends a heartbeat every 60 s only while active; the server credits at most 70 s per heartbeat and ignores heartbeats after a session ended.

## Global Constraints

- Everything in `.superpowers/sdd/2026-10-31-tralked-plano-2/global-constraints.md` (pt-BR UI, tokens only, zod on every mutation, session + role checks, axe 0 serious/critical, reduced motion, own test DB per worktree, never `gamelog`/`gamelog_dev`, `NEXT_BUILD_CPUS=4` for builds).
- Spec: "O jogo roda 100% no navegador do usuário. O servidor só guarda conta, catálogo, saves e progresso, e nunca recebe uma ROM ou BIOS."
- Spec: "O usuário nunca vê a interface padrão do EmulatorJS." Default buttons hidden by config; commands go through its JS API.
- Spec: "Do login ao jogo são no máximo 3 cliques para quem já carregou o arquivo uma vez."
- Spec: "Nenhum save é apagado sem confirmação."
- Spec prohibitions: never host/send/link ROMs or ISOs; never distribute BIOS or point to downloads; never upload the user's file; never use game covers/logos/names as avatar items or player branding; covers only via API with credit.
- Spec UI copy: on the load-file screen, "o arquivo fica só no seu dispositivo"; the user declares they use their own legally obtained copies.
- Spec licenses: "Código-fonte e licenças" link in the player footer listing each core, author and license; keep original copyright notices; own name/logo for the player, never the upstream project names as brand.
- EmulatorJS and cores are served from our origin at a pinned version (no third-party CDN at runtime).

## Review Focus

1. A file that is not a SNES/PS1 image (a renamed .zip, a .txt, a 2 GB file, a CUE without its BIN) → clear pt-BR error before the engine starts, nothing hashed beyond the size cap, nothing sent. (Task 2)
2. Two devices saving the same game: the device with an older `baseVersion` PUTs → 409 with both versions, the conflict screen shows date + thumbnail of each, and choosing one never deletes the other (it becomes a version). (Tasks 4, 7)
3. Idle or background tab, two tabs open, or a forged heartbeat flood → no playtime XP beyond D6 caps and the 6000/day cap; one open session per user (a second start closes the first). (Tasks 4, 5)
4. Logged-out user, another user's gameKey, or a save body over the cap / not gzip → 401/404/413/422 without touching other users' rows. (Task 4)
5. PS1 without BIOS, with an unknown BIOS (hash not in the list), or on Safari iOS → falls back to PCSX ReARMed with a visible note, or a clear "não suportado" message; never a blank canvas. (Tasks 2, 6)

---

### Task 1: Pinned engine, self-hosted, behind a typed wrapper

**Files:**
- Modify: `app/package.json` (exact-version devDependencies for the four EmulatorJS packages; script `emulator:vendor`)
- Create: `app/scripts/emulator-vendor.ts` (copies `data/` and the three cores from `node_modules` into `public/emulator/<version>/`, writes `public/emulator/<version>/LICENSES.json` with core, upstream name, author, license, source URL)
- Create: `app/src/lib/emulator/engine.ts`, `app/src/lib/emulator/cores.ts`
- Modify: `app/.gitignore` (ignore `public/emulator/`; the vendor script runs in `postinstall` after `prisma generate`)
- Test: `app/src/lib/emulator/cores.test.ts`, `app/src/lib/emulator/engine.test.ts`

**Interfaces:**
- Produces: `type Console = "snes" | "psx"`; `CORES: Record<Console, { primary: string; fallback?: string; extensions: string[]; needsBios: boolean }>` with `snes: { primary: "bsnes", extensions: ["sfc","smc"], needsBios: false }`, `psx: { primary: "mednafen_psx_hw", fallback: "pcsx_rearmed", extensions: ["cue","bin","iso","chd","pbp"], needsBios: true }`; `EMULATOR_VERSION: string` (read from the vendored folder name); `pickCore(console: Console, hasValidBios: boolean): string`.
- Produces: `createEngine(opts: { container: HTMLElement; core: string; rom: Blob; bios?: Blob; onReady(): void; onError(e: Error): void; onExit(): void }): Promise<Engine>` where `Engine = { pause(): void; resume(): void; isRunning(): boolean; saveState(): Promise<Uint8Array>; loadState(s: Uint8Array): Promise<void>; readSaveFile(): Promise<Uint8Array | null>; writeSaveFile(b: Uint8Array): Promise<void>; screenshot(): Promise<Blob>; setFullscreen(on: boolean): void; destroy(): void }`. Implemented over `window.EJS_*` globals + `window.EJS_emulator.gameManager` (`getState`, `loadState`, `getSaveFile`, `getSaveFilePath` + FS write + `loadSaveFiles`), with `EJS_Buttons` all `false`, `EJS_startOnLoaded = true`, `EJS_pathtodata = "/emulator/<version>/data/"`, `EJS_askBeforeExit = false`, `EJS_disableLocalStorage = true`. Verify every global and method name against the docs of the pinned version (Context7 `/emulatorjs/emulatorjs`, docs4devs/cores) before coding; record the version in the module header.

- [ ] **Step 1:** Write `cores.test.ts`: `pickCore("psx", true) === "mednafen_psx_hw"`, `pickCore("psx", false) === "pcsx_rearmed"`, `pickCore("snes", false) === "bsnes"`; `CORES.snes.extensions` excludes `zip`.
- [ ] **Step 2:** Run `pnpm exec vitest run src/lib/emulator/cores.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Pin the packages, write `emulator-vendor.ts`, `cores.ts`. Run `pnpm emulator:vendor`; confirm `public/emulator/<version>/data/loader.js` and the three core files exist and `LICENSES.json` lists them.
- [ ] **Step 4:** Write `engine.test.ts` (jsdom, fake `window.EJS_emulator`): `createEngine` sets `EJS_Buttons` with every key `false` and the pinned `EJS_pathtodata`; `saveState()` returns the fake `getState()` bytes; `writeSaveFile` writes to `getSaveFilePath()` then calls `loadSaveFiles`; `destroy()` removes the injected loader script and clears the globals. Run — FAIL; implement `engine.ts`; run — PASS.
- [ ] **Step 5:** Commit `feat(emulator): pinned self-hosted EmulatorJS and typed engine wrapper`.

### Task 2: Device vault and ROM/BIOS identification

**Files:**
- Create: `app/src/lib/emulator/vault.ts` (IndexedDB `tralked-emulador`, stores `roms` keyed by `${console}:${hash}` and `bios` keyed by md5, value `{ name, size, addedAt, blob }`)
- Create: `app/src/lib/emulator/hash.ts`, `app/src/lib/emulator/hash-psx.ts`, `app/src/lib/emulator/md5.ts` (incremental MD5; Web Crypto has no MD5), `app/src/lib/emulator/bios.ts`
- Test: `hash.test.ts`, `hash-psx.test.ts`, `bios.test.ts`, `vault.test.ts` (fake-indexeddb)

**Interfaces:**
- Produces: `hashRom(console: Console, files: File[]): Promise<{ hash: string; primary: File } | { error: RomError }>` with `RomError = "extensao" | "tamanho" | "faltando_bin" | "ilegivel"`; size caps SNES 16 MB, PS1 900 MB per disc.
- Produces: `validateBios(file: File): Promise<{ ok: true; md5: string; region: "NTSC-U" | "NTSC-J" | "PAL" } | { ok: false }>` against a constant list of known PS1 BIOS MD5s in `bios.ts` (SCPH-1001, -5501, -7001, -1002, -5502, -5552, -7502, -1000, -3000, -5500, -7000 at least; values from the RA/libretro docs, cited in a comment).
- Produces: `vault.putRom(console, hash, file)`, `vault.getRom(console, hash): Promise<Blob | null>`, `vault.hasRom(console, hash): Promise<boolean>`, `vault.putBios(md5, file)`, `vault.getAnyBios(): Promise<{ md5: string; blob: Blob } | null>`, `vault.removeRom(console, hash)`.

- [ ] **Step 1:** Tests for SNES: a 1 MB synthetic ROM and the same with a 512-byte header (size % 1024 === 512) hash to the same MD5; `.zip` → `{ error: "extensao" }`; 17 MB → `"tamanho"`.
- [ ] **Step 2:** Tests for PS1 with a synthetic ISO9660 image built in the test (PVD at sector 16, root dir with `SYSTEM.CNF` containing `BOOT = cdrom:\SLUS_000.01;1` and that file): hash equals MD5 of `"SLUS_000.01"` bytes followed by the executable bytes (RA method; cite the RA docs URL in the test). A CUE whose BIN is not among the selected files → `"faltando_bin"`. Raw 2352-byte sectors and 2048-byte ISO both work.
- [ ] **Step 3:** `bios.test.ts`: a file whose MD5 is in the list → ok with region; any other → `{ ok: false }` (use a stub list injected for the test; never commit BIOS bytes).
- [ ] **Step 4:** `vault.test.ts` with `fake-indexeddb`: put/get/has/remove round-trip.
- [ ] **Step 5:** Run all four — FAIL; implement; run — PASS. Commit `feat(emulator): device vault and RA-compatible ROM hashing`.

### Task 3: Data model, RA hash catalog and identify

**Files:**
- Modify: `app/prisma/schema.prisma` + new additive migration `emulator`
- Create: `app/src/lib/emulator/catalog.ts`, `app/scripts/emulator-hashes.ts` (`pnpm emulator:hashes`), cron job `emulator-hashes` (weekly) in the existing cron route
- Modify: `app/src/lib/integrations/retro/{client.ts,types.ts,fixture.ts}` (game hash list per console)
- Test: `catalog.db.test.ts`, retro client test additions

**Interfaces:**
- Produces models:
  - `RomHash { console String; hash String; raGameId String; title String; gameId String? (→ Game) ; @@id([console, hash]) }`
  - `EmuSave { id; userId; gameKey String; kind String /* sram | state */; slot Int @default(0); version Int; data Bytes /* gzip */; size Int; thumb Bytes?; device String; createdAt; @@unique([userId, gameKey, kind, slot, version]); @@index([userId, gameKey]) }`
  - `EmuSession { id; userId; gameKey; console; startedAt; lastBeatAt; endedAt DateTime?; activeSeconds Int @default(0); @@index([userId, endedAt]) }`
  - `UserBadge { userId; badge String; awardedAt; @@id([userId, badge]) }`
  - `gameKey` = catalog `Game.id` when matched, else `hash:<console>:<hash>`.
- Produces: `identifyRom(console: Console, hash: string): Promise<{ gameKey: string; game: { id: string; slug: string; name: string; coverUrl: string | null } | null; raGameId: string | null }>`.
- Produces: `RetroApi.getGameHashes(consoleId: number): Promise<{ gameId: string; title: string; hashes: string[] }[]>` (SNES = 3, PS1 = 12).
- Consumes: existing `GamePlatformLink` (platform `retro`) to map `raGameId` → `Game`.

- [ ] **Step 1:** `catalog.db.test.ts`: after importing fixture hashes, `identifyRom("snes", <fixture hash>)` returns the catalog game linked to that RA id; an unknown hash returns `{ gameKey: "hash:snes:<hash>", game: null, raGameId: null }`; hash input is lowercased and must match `/^[0-9a-f]{32}$/`.
- [ ] **Step 2:** Run — FAIL; write schema + migration (additive only), retro client method + fixture, `catalog.ts`, script and cron job (idempotent upserts; never deletes rows). Run — PASS.
- [ ] **Step 3:** `pnpm exec prisma migrate dev` on the worktree DB, then commit `feat(emulator): ROM hash catalog, saves, sessions and badges schema`.

### Task 4: Emulator API (library, identify, saves, sessions)

**Files:**
- Create: `app/src/app/api/emulador/{biblioteca,identificar,saves/[gameKey],sessoes}/route.ts`
- Create: `app/src/lib/emulator/saves.ts`, `app/src/lib/emulator/sessions.ts`
- Test: `saves.db.test.ts`, `sessions.db.test.ts`, `api/emulador/*.test.ts`

**Interfaces:**
- `GET /api/emulador/biblioteca` → `{ games: { gameKey; console; name; slug: string | null; coverUrl; lastPlayedAt; totalSeconds; lastSave: { kind; version; createdAt } | null; raProgress: { unlocked; total } | null }[] }`.
- `POST /api/emulador/identificar` body `{ console, hash }` → `identifyRom` result.
- `GET /api/emulador/saves/[gameKey]?kind=&slot=` → `{ versions: { version; createdAt; size; device; hasThumb }[] }`; `GET …?version=N&download=1` → gzip bytes (`application/gzip`).
- `PUT /api/emulador/saves/[gameKey]` multipart: `kind`, `slot`, `baseVersion` (latest version the client knew, or 0), `device`, `data` (gzip), `thumb?` → `201 { version }`; `409 { latest: { version, createdAt, device } }` when `baseVersion` ≠ current latest; keeps the newest 10 versions (oldest beyond 10 deleted in the same transaction — the only deletion, and it is the spec's "últimas 10 versões").
- `POST /api/emulador/sessoes` body `{ action: "start", gameKey, console } | { action: "beat", sessionId } | { action: "end", sessionId }` → start: `{ sessionId }` (ends any open session of the user first); beat: `{ ok }`; end: `SessionSummary` (Task 5).
- All: Tralked session required (401), zod bodies (422 with field path), gameKey must be the user's own or a valid `hash:` key, size caps from D3 (413, checked while streaming with `lib/api/read-capped.ts`), gzip magic bytes checked (422), rate limit 30 req/min/user on PUT.

- [ ] **Step 1:** `saves.db.test.ts`: 11 PUTs keep versions 2..11; PUT with stale `baseVersion` → conflict with latest metadata and nothing written; other user's gameKey listing returns empty.
- [ ] **Step 2:** `sessions.db.test.ts`: start twice → first ended; beat after end ignored; beat credits `min(elapsed since lastBeatAt, 70)` seconds.
- [ ] **Step 3:** Route tests: 401 logged out, 413 over cap, 422 non-gzip, 409 path.
- [ ] **Step 4:** Run — FAIL; implement; run — PASS. Commit `feat(emulator): library, identify, versioned saves and sessions API`.

### Task 5: Playtime XP, first-console XP, badges, session summary, "jogando agora"

**Files:**
- Create: `app/src/lib/emulator/rewards.ts`
- Modify: `app/src/lib/progression/recompute.ts` (new ledger sources), `prisma/schema.prisma` ledger doc comment, player profile header + avatar ("jogando agora"), `app/src/lib/emulator/sessions.ts` (call rewards on beat/end)
- Test: `rewards.db.test.ts`, profile render test

**Interfaces:**
- Ledger sources: `emu_playtime` (sourceKey `${userId}:${yyyy-mm-dd}:${n}` per credited 30-min block, 600 XP, max 10 blocks/day), `emu_first_console` (sourceKey `console`, 7500 XP). Recognized games only (D5).
- Badges: `primeira_fita` (first ended session with ≥ 60 active s), `colecionador_16bit` (5 distinct SNES catalog games with a valid RA completion — reuse `validCompletions` from `lib/progression/completions.ts`), `memoria_cheia` (10 distinct PS1 gameKeys with at least one cloud save). Awarded idempotently on session end and on save PUT; a notification per badge.
- `type SessionSummary = { activeSeconds: number; xpGained: number; level: { before: number; after: number; fraction: number }; badges: string[]; raUnlockedDuring: number }`. `raUnlockedDuring`: on session end, if the user has a verified RetroAchievements account and the game has a `raGameId`, run the existing RA sync for that one game (bounded by the existing sync slot/rate limit; skipped when the slot is taken) and count unlocks with `unlockedAt` inside the session window.
- "Jogando agora": session with `endedAt = null` and `lastBeatAt` < 3 min ago → profile header and avatar show the game name and elapsed time; private profiles never show it.

- [ ] **Step 1:** Tests: 95 active minutes in one day → 3 blocks = 1800 XP; 6 hours → capped at 6000; unrecognized gameKey → 0 XP; first PS1 session → 7500 once; badges awarded once each; summary numbers match the ledger.
- [ ] **Step 2:** Run — FAIL; implement; run — PASS; `recompute` test still green. Commit `feat(emulator): playtime XP, badges, session summary and now playing`.

### Task 6: Library and game page

**Files:**
- Create: `app/src/app/jogar/page.tsx` (biblioteca), `app/src/app/jogar/[console]/[gameKey]/page.tsx` (página do jogo), components in `app/src/components/emulator/` (`LibraryGrid`, `LoadFileCard`, `BiosCheck`, `SaveList`, `GameAchievements`)
- Modify: header nav (`NAV_ITEMS` gets `{ href: "/jogar", label: "Jogar" }` after "Jogos"), footer ("Direitos autorais" link)
- Test: component tests + e2e `e2e/emulador.spec.ts` (library and game page parts)

**Interfaces:**
- Consumes: Task 2 vault/hash, Task 4 API, Task 1 `pickCore`.
- Library: games grouped by console, catalog cover with credit, RA progress, "pronto neste dispositivo" badge when `vault.hasRom`; empty state invites "Carregar meu arquivo".
- Game page: "Carregar meu arquivo" (file input + drop zone; copy: "O arquivo fica só no seu dispositivo." and the declaration "Uso só cópias minhas, obtidas legalmente."), PS1 BIOS check (valid → core Beetle PSX HW; none/unknown → note "Sem BIOS: usando o modo compatível" and PCSX ReARMed), achievements list (catalog RA achievements), cloud saves, total play time, "Jogar" button. Logged out → `/entrar?returnTo=…`.
- Three-click rule: from the header "Jogar" → game card → "Jogar" when the ROM is in the vault.

- [ ] **Step 1:** e2e (engine mocked by a test-only `window.__TRALKED_FAKE_ENGINE__` hook that exists only outside production): upload a synthetic SNES ROM → identified → appears in library with "pronto neste dispositivo"; reload → still ready; `.zip` → error message; logged out → redirected to `/entrar`.
- [ ] **Step 2:** Run — FAIL; implement; run — PASS; axe on both pages. Commit `feat(emulator): library and game page`.

### Task 7: Player, pause menu, conflict screen, controls, summary

**Files:**
- Create: `app/src/app/jogar/[console]/[gameKey]/jogar/page.tsx` (full-viewport player route), components `Player`, `PlayerBar`, `PauseMenu`, `SaveConflictDialog`, `ControlsDialog`, `SessionSummaryDialog`, `LoadingScreen` (Tralked emblem animation, reduced-motion static), `PlayerFooterLicenses`
- Create: `app/src/lib/emulator/activity.ts` (D6 active-play tracker), `app/src/lib/emulator/autosave.ts`
- Test: component tests, e2e `emulador.spec.ts` (player part, fake engine), opt-in engine smoke `e2e/emulador-smoke.spec.ts` (runs only when `EMU_SMOKE_ROM` points to a homebrew ROM on disk)

**Interfaces:**
- Consumes: `createEngine` (Task 1), vault (Task 2), saves/sessions API (Task 4), `SessionSummary` (Task 5).
- Bar: Salvar, Carregar, Pausar/Continuar, Tela cheia, Controles, Sair — keyboard reachable, visible focus; Esc opens the pause menu.
- Pause menu: save states with thumbnails (cloud versions), "Salvar agora", load a version (confirmation), achievements of the game, controls and video (scale, smoothing).
- On start: fetch latest cloud SRAM; if a local SRAM exists in the engine FS and differs (by hash) from the cloud one → `SaveConflictDialog` with date + thumbnail of each; the chosen one is loaded; the other is uploaded as a new version (never discarded).
- Autosave: SRAM every 60 s when changed and on exit; save states only on user action.
- Controls: keyboard and gamepad mapping persisted per console in `localStorage` (try/catch); touch controls (EmulatorJS virtual gamepad) only for SNES on touch devices.
- Exit: end session → `SessionSummaryDialog` (time, achievements during the session, XP, level progress), then back to the game page.
- Unsupported browser (no WebAssembly, or iOS Safari for PS1) → message instead of the canvas.

- [ ] **Step 1:** e2e with the fake engine: start → bar visible, default EmulatorJS UI absent; Salvar → PUT 201; second tab with stale base → conflict dialog shows two options and keeps both; Sair → summary with time and XP; Esc → pause menu; keyboard-only path works.
- [ ] **Step 2:** `activity.test.ts`: hidden tab or 5 min without input → no heartbeat.
- [ ] **Step 3:** Run — FAIL; implement; run — PASS; axe on the player route (canvas aria-label). Commit `feat(emulator): branded player, pause menu, conflicts and summary`.
- [ ] **Step 4:** Controller runs the opt-in smoke with a homebrew ROM on SNES and records FPS/console errors in the report.

### Task 8: Legal, privacy, licenses, docs

**Files:**
- Modify: `app/src/app/termos/page.tsx` (emulator section: own legal copies; no ROM/BIOS hosting; prohibited uses), `app/src/app/privacidade/page.tsx` (sessions, saves, hashes, retention, LGPD export/deletion include `EmuSave`, `EmuSession`, `UserBadge`), `app/src/app/licencas/page.tsx` (EmulatorJS + each core from `LICENSES.json`: author, license, upstream source URL at the pinned version, copyright notices), new `app/src/app/direitos-autorais/page.tsx` (copyright report and removal contact), `lib/accounts/export.ts` + `delete.ts`, `README.md` (emulator section, `emulator:vendor`, `emulator:hashes`, decisions D1–D6), article "Em breve…" stays as is.
- Test: export/delete tests include emulator rows; e2e licenses page lists the three cores.

- [ ] **Step 1:** Tests — FAIL; implement; PASS. Commit `docs(emulator): terms, privacy, licenses and copyright channel`.

### Task 9: Validation

- [ ] Gate: `pnpm exec next typegen && pnpm lint && pnpm exec tsc --noEmit && pnpm test && NEXT_BUILD_CPUS=4 pnpm build` with the worktree DB; e2e dev + prod; axe 0 serious/critical.
- [ ] Controller: apply the migration to `gamelog_dev` (`prisma migrate deploy`), run `pnpm emulator:vendor`, check `/jogar` in Chrome on desktop and a phone viewport, update the shared link.
