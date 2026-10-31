# GAMELOG Plano 1 — Fundação do MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o app GAMELOG rodando localmente com identidade visual do handoff, motor RPG testado, banco com dados de exemplo, login Steam, sincronização de conquistas e as páginas públicas do MVP.

**Architecture:** Next.js App Router (Server Components lendo do Postgres via Prisma). Regras do jogo vivem em `src/lib/engine` (funções puras, sem I/O). Integrações externas ficam atrás de interfaces em `src/lib/integrations`, com implementação `fixture` usada quando a chave não existe. Sincronização grava em ledger de XP; nível/skills são derivados.

**Tech Stack:** Next.js (última estável, App Router, TypeScript, Tailwind CSS), Postgres 16 (Docker Compose), Prisma (última estável), Vitest + Testing Library, `jose` (JWT), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-31-gamelog-design.md` (ler junto). Referências visuais: `design_handoff_pxn_games_home/README.md` e `preview/index.html` (prévia aprovada: copiar estrutura, textos e comportamento das telas).

## Global Constraints

- Idioma da interface: português do Brasil. Nome do produto: **GAMELOG**.
- Tokens visuais exatamente os do handoff: `bg #0B0C0F`, `bg-deep #08090B`, `surface #121317`, `surface-2 #141519`, `border #1E2026`, `border-2 #2C2E36`, `text #ECECE6`, `accent #C6F432`, plataformas `oklch(0.74 0.14 255|145|25|75)` (PS/Xbox/Nintendo/PC); raridade: comum `#9EA1A9`, incomum `oklch(0.74 0.14 145)`, rara `oklch(0.74 0.14 255)`, épica `oklch(0.72 0.16 305)`, lendária `oklch(0.80 0.15 75)`.
- Fontes: Archivo (eixo `wdth` 62–125, peso 400–900) e JetBrains Mono (400/500/700) via `next/font/google`.
- Raio 2px (botões, inputs, tags) e 4px (cards). Largura máx. 1320px, gutter 20px. Breakpoint de menu gaveta: 900px.
- Fórmulas RPG exatamente as da spec §5.
- Nenhuma página chama API externa durante a renderização.
- O app precisa rodar sem nenhuma chave de API (fixtures + seed).
- Antes de usar Next.js, Prisma, Tailwind ou `jose`, consultar a documentação atual via Context7 (`resolve-library-id` → `query-docs`).
- Commits só dos arquivos da própria tarefa; mensagens em inglês no formato `feat:`/`test:`/`chore:`.

## Review Focus

1. Usuário com perfil Steam **privado** → sincronização não quebra; perfil mostra aviso "Seu perfil Steam está privado" e não concede XP (Task 8).
2. Jogo **sem conquistas** ou com raridade ausente → não entra no catálogo / conquista sem `globalPct` usa 50% (Task 3, Task 8).
3. Sincronização rodando **duas vezes** → não duplica XP (ledger idempotente por `userId+achievementId`) (Task 8).
4. Conquistas em **rajada** (≥10 em ≤60s) → marcadas suspeitas e fora do XP/ranking (Task 4, Task 8).
5. Convite de família **expirado ou já usado** e usuário que já está em outra família → mensagem clara, sem crash (Task 12).

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `app/` (projeto Next.js em `C:\projetos\Nova pasta\app`), `app/docker-compose.yml`, `app/.env.example`, `app/vitest.config.ts`, `app/src/lib/env.ts`, `app/src/lib/env.test.ts`
- Modify: `.gitignore` (raiz) se necessário

**Interfaces:**
- Produces: scripts `pnpm dev`, `pnpm build`, `pnpm test` (Vitest, run mode), `pnpm lint`, `pnpm db:up` (docker compose up -d), `pnpm db:migrate`, `pnpm db:seed`; alias `@/*` → `src/*`; `env` exportado de `src/lib/env.ts`:
  `export const env: { DATABASE_URL: string; SESSION_SECRET: string; APP_URL: string; STEAM_API_KEY?: string; IGDB_CLIENT_ID?: string; IGDB_CLIENT_SECRET?: string; RAWG_API_KEY?: string; SGDB_API_KEY?: string; CRON_SECRET: string }` e `export function hasKey(name: 'STEAM_API_KEY'|'IGDB_CLIENT_ID'|'RAWG_API_KEY'|'SGDB_API_KEY'): boolean`.

- [ ] **Step 1:** Criar o app com `pnpm create next-app@latest app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes` (confirmar flags atuais via Context7).
- [ ] **Step 2:** Instalar dependências que outras tarefas usam: `prisma @prisma/client jose zod` e dev `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom tsx`. Configurar Vitest (environment `node` por padrão; testes `*.test.tsx` em `jsdom`).
- [ ] **Step 3:** `docker-compose.yml` com `postgres:16`, usuário/senha/banco `gamelog`, porta host `5433`. `.env.example` com `DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog`, `SESSION_SECRET`, `APP_URL=http://localhost:3000`, `CRON_SECRET`, e as chaves opcionais vazias.
- [ ] **Step 4: Teste** `src/lib/env.test.ts`: `hasKey('STEAM_API_KEY')` é `false` quando a variável está vazia e `true` quando definida.
- [ ] **Step 5:** Rodar `pnpm test` (PASS), `pnpm lint` e `pnpm build` (sem erros).
- [ ] **Step 6: Commit** `chore: scaffold GAMELOG Next.js app`.

### Task 2: Identidade visual e layout base

**Files:**
- Create: `src/app/globals.css` (tokens como CSS variables + tema Tailwind), `src/app/layout.tsx`, `src/components/brand/Logo.tsx`, `src/components/layout/Header.tsx`, `src/components/layout/MobileDrawer.tsx`, `src/components/layout/SearchBox.tsx`, `src/components/layout/Footer.tsx`, `src/components/layout/Newsletter.tsx`, `src/components/ui/{Button,Chip,PlatformChips,FilterChips,SectionHead,Card,ProgressBar,Ring,Placeholder}.tsx`, `src/components/layout/Header.test.tsx`

**Interfaces:**
- Produces: `<Logo size?: 44|34 />`; `<SectionHead title: string, aside?: ReactNode />`; `<Chip color?: string, plain?: boolean>`; `<PlatformChips platforms: Platform[] />` com `type Platform = 'PLAYSTATION'|'XBOX'|'NINTENDO'|'PC'`; `<FilterChips options: {id:string,label:string,color?:string}[], value: string, onChange(id) />` (client); `<ProgressBar value: number /* 0..100 */ />`; `<Ring value: number, size?: number />`; `<Placeholder label: string, ratio?: string />`; `<Button variant: 'primary'|'ghost'>`.
- Logo: símbolo Badge (quadrado acento, canto inferior direito cortado `polygon(0 0,100% 0,100% 72%,72% 100%,0 100%)`) com um ✓ escuro no lugar do X; logotipo "GAME" + "LOG" (LOG no acento), Archivo 900 stretch 125%; tagline "Feito por pessoas que amam jogar".
- Header: Logo · nav (Notícias `/`, Jogos e guias `/jogos`, Personagem `/jogador/me`, Highscores `/highscores`, Família `/familia`) · busca · avatar com nível · botão de menu < 900px. Footer e newsletter conforme handoff, com créditos "Dados de jogos: IGDB, RAWG. Arte: SteamGridDB." e links `/privacidade` e `/termos`.

- [ ] **Step 1: Teste** `Header.test.tsx`: renderiza os 5 links com hrefs acima; o link da rota atual tem `aria-current="page"`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar tokens, fontes e componentes seguindo a prévia (`preview/index.html`, seções de CSS "Header", "Componentes base", "Rodapé").
- [ ] **Step 4:** Rodar testes (PASS) e `pnpm build`.
- [ ] **Step 5: Commit** `feat: GAMELOG visual identity and base layout`.

### Task 3: Motor RPG — XP, raridade, skills, vocação

**Files:**
- Create: `src/lib/engine/xp.ts`, `src/lib/engine/skills.ts`, `src/lib/engine/vocation.ts`, `src/lib/engine/types.ts`, testes `*.test.ts` ao lado.

**Interfaces:**
- Produces (`types.ts`): `type SkillId = 'fps'|'horror'|'soulslike'|'rpg'|'roguelike'|'plataforma'|'estrategia'|'simulacao'|'puzzle'|'coop'|'sabio'`; `const SKILLS: {id: SkillId; name: string}[]` (nomes: FPS, Survival Horror, Soulslike, RPG, Roguelike, Plataforma, Estratégia, Simulação, Puzzle, Co-op, Sábio (guias)); `type RarityTier = 'comum'|'incomum'|'rara'|'epica'|'lendaria'`; `type SkillState = { level: number; points: number }`.
- `xp.ts`: `expFor(level: number): number`; `levelFromXp(totalXp: number): { level: number; current: number; next: number; fraction: number }` (nível mínimo 1); `xpForAchievement(globalPct: number | null): number` (null → 50); `rarityTier(globalPct: number): RarityTier`; `platinumBonus(achievementXps: number[]): number` (10% da soma, arredondado).
- `skills.ts`: `skillNeed(level: number): number`; `skillPointsFor(xp: number, skillCount: number): number`; `applySkillPoints(state: SkillState, points: number): { state: SkillState; levelsGained: number }`.
- `vocation.ts`: `vocationFor(skills: Record<SkillId, SkillState>): string` (ignora `sabio`; pares: soulslike+plataforma "Lâmina Sombria", soulslike+rpg "Cavaleiro Maculado", fps+horror "Caçador", rpg+estrategia "Arquimago", roguelike+estrategia "Trapaceiro da Sorte", puzzle+coop "Engenheiro de Portais", fps+coop "Sobrevivente"; fallback `Andarilho de <nome da skill mais alta>`; desempate por pontos).

- [ ] **Step 1: Testes** (valores exatos):
  - `expFor(1) === 0`, `expFor(2) === 100`, `expFor(47) === 1522600`, `expFor(48) === 1626200`.
  - `levelFromXp(0).level === 1`; `levelFromXp(1522600).level === 47`; `levelFromXp(1626199).level === 47`; `levelFromXp(1626200).level === 48`.
  - `xpForAchievement(2) === 18643`; `xpForAchievement(50) === 2665`; `xpForAchievement(null) === 2665`.
  - `rarityTier(3) === 'lendaria'`, `rarityTier(3.1) === 'epica'`, `rarityTier(8) === 'epica'`, `rarityTier(20) === 'rara'`, `rarityTier(50) === 'incomum'`, `rarityTier(50.1) === 'comum'`.
  - `platinumBonus([1000, 2000]) === 300`.
  - `skillNeed(30) === Math.round(120 * 1.085 ** 30)`; `skillPointsFor(18643, 2) === 777`.
  - `applySkillPoints({level:30,points:skillNeed(30)-10}, 25)` → `{state:{level:31,points:15}, levelsGained:1}`; pontos que atravessam 2 níveis retornam `levelsGained: 2`.
  - `vocationFor` com soulslike 34 e plataforma 31 no topo → `'Lâmina Sombria'`; sabio alto é ignorado; par sem mapeamento com fps no topo → `'Andarilho de FPS'`.
- [ ] **Step 2:** Rodar e ver falhar. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: RPG engine xp, skills and vocation`.

### Task 4: Motor RPG — sequência, missões, antifraude

**Files:**
- Create: `src/lib/engine/streak.ts`, `src/lib/engine/missions.ts`, `src/lib/engine/fraud.ts`, testes ao lado.

**Interfaces:**
- Consumes: `SkillId`, `rarityTier` (Task 3).
- Produces:
  - `streak.ts`: `type StreakResult = { current: number; best: number; shields: number; activeToday: boolean }`; `computeStreak(activeDays: string[] /* 'YYYY-MM-DD' em America/Sao_Paulo */, today: string): StreakResult` — 1 escudo ganho a cada 7 dias seguidos (máx. 2), cada escudo cobre 1 dia sem atividade; `toLocalDay(date: Date): string` (fuso `America/Sao_Paulo`).
  - `missions.ts`: `type MissionCondition = { minCount: number; maxGlobalPct?: number; skill?: SkillId; gameId?: string }`; `type UnlockEvent = { achievementId: string; gameId: string; globalPct: number | null; skills: SkillId[]; unlockedAt: Date; suspicious: boolean }`; `missionProgress(cond: MissionCondition, events: UnlockEvent[]): { count: number; done: boolean }` (ignora `suspicious`); `DAILY_TEMPLATES` e `WEEKLY_TEMPLATES` (textos da prévia: "Desbloqueie 3 conquistas raras" 12000 XP, "Ganhe XP em <skill>" 5000 XP, "Desbloqueie 10 conquistas de <skill>" 40000 XP); `generateMissions(seed: string, kind: 'daily'|'weekly', topSkills: SkillId[]): { title: string; condition: MissionCondition; rewardXp: number }[]` (determinístico pela seed; 3 diárias, 2 semanais).
  - `fraud.ts`: `findBursts(unlocks: {achievementId: string; unlockedAt: Date}[], windowSec = 60, minCount = 10): Set<string>`; `isSpeedPlatinum(playtimeMin: number, avgCompletionMin: number | null): boolean` (true se `avg` existe e `playtime < 0.05 * avg`).
- [ ] **Step 1: Testes**:
  - streak: dias consecutivos `['2026-10-25'..'2026-10-31']` com today `2026-10-31` → `current 7, shields 1, activeToday true`; buraco de 1 dia com escudo disponível mantém a sequência; buraco de 1 dia sem escudo zera; `toLocalDay(new Date('2026-11-01T02:00:00Z')) === '2026-10-31'`.
  - missions: 3 eventos raros (pct ≤ 20) e 1 suspeito → `{count:3, done:true}` para `{minCount:3,maxGlobalPct:20}`; filtro por skill; `generateMissions('2026-10-31','daily',['soulslike'])` retorna 3 itens e é igual em duas chamadas.
  - fraud: 10 desbloqueios em 59s → os 10 ids no set; 9 em 59s → set vazio; 10 espalhados em 10 min → vazio; `isSpeedPlatinum(10, 600) === true`, `isSpeedPlatinum(100, 600) === false`, `isSpeedPlatinum(10, null) === false`.
- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** `feat: streak, missions and anti-fraud rules`.

### Task 5: Banco de dados e seed

**Files:**
- Create: `prisma/schema.prisma` (ou local exigido pela versão atual do Prisma), `src/lib/db.ts`, `prisma/seed.ts`, `prisma/seed-data/{games,guides,news,users}.ts`, `src/lib/db.test.ts`

**Interfaces:**
- Produces: `prisma` singleton em `src/lib/db.ts`. Modelos (campos mínimos; ids `cuid`, `createdAt/updatedAt` onde fizer sentido):
  - `User { id, steamId @unique, handle @unique, displayName, avatarUrl?, profilePublic Boolean, role String @default("user") /* admin|editor|author|user */, lastSyncedAt? }`
  - `Game { id, slug @unique, name, steamAppId Int @unique, igdbId Int?, rawgId Int?, sgdbId Int?, summary?, releaseDate?, criticScore Int?, coverUrl?, heroUrl?, logoUrl?, timeToBeatCompleteMin Int?, platforms String[], achievementCount Int }`
  - `GameSkill { gameId, skill String, @@id([gameId, skill]) }`
  - `Achievement { id, gameId, apiName, name, description?, iconUrl?, globalPct Float?, hidden Boolean, @@unique([gameId, apiName]) }`
  - `UserGame { userId, gameId, playtimeMin Int, unlockedCount Int, completedAt DateTime?, @@id([userId, gameId]) }`
  - `UserAchievement { userId, achievementId, unlockedAt DateTime, suspicious Boolean @default(false), @@id([userId, achievementId]) }`
  - `XpLedgerEntry { id, userId, source String /* 'achievement'|'platinum'|'mission'|'guide_vote' */, sourceKey String, xp Int, skills String[], createdAt, @@unique([userId, source, sourceKey]) }`
  - `SkillProgress { userId, skill, level Int, points Int, @@id([userId, skill]) }`, `UserStats { userId @id, totalXp Int, level Int, vocation String, streakCurrent Int, streakBest Int, shields Int }`
  - `Mission { id, userId, kind String, periodKey String, title, condition Json, rewardXp Int, progress Int, completedAt? , @@unique([userId, kind, periodKey, title]) }`
  - `Guide { id, gameId @unique, authorId, status String /* draft|review|published */, version String, difficulty Int, hoursMin Int, hoursMax Int, playthroughs String, missables Int, online Int, overview String[], warnings String[], usefulCount Int, publishedAt? }`, `GuideStep { id, guideId, order Int, title, hours String, body, achievementApiNames String[] }`, `GuideAchievementNote { id, guideId, achievementId, category String, spoiler Boolean, tip String, steps String[] }`, `GuideTip { id, guideId, authorId, body, votes Int }`, `GuideVote { userId, tipId, @@id([userId, tipId]) }`, `GuideRevision { id, guideId, version, summary, authorId, createdAt }`, `GuideStepProgress { userId, stepId, @@id([userId, stepId]) }`
  - `Author { id, handle @unique, userId? }`, `Article { id, slug @unique, title, subtitle?, body String /* markdown */, category String /* GAMES|GUIAS|COMUNIDADE */, platforms String[], imageLabel String, authorId, gameId?, featured Int /* 0 lista, 1 destaque lateral, 2 principal */, likes Int, comments Int, humanAuthored Boolean, publishedAt }`
  - `Family { id, name, ownerId }`, `FamilyMember { familyId, userId @unique, role String, joinedAt, @@id([familyId, userId]) }`, `FamilyInvite { id, familyId, token @unique, expiresAt, usedAt? }`
  - `NewsletterSubscriber { email @unique, confirmedAt? }`
- Seed: os 14 jogos, o guia completo de Hollow Knight (todas as etapas, conquistas, dicas, coletáveis como `warnings`/notas, revisões), as 10 notícias e os jogadores de exemplo da prévia (`preview/index.html`, objetos `GAMES`, `HK`, `HERO/SIDE/NEWS`, `HANDLES`), usuário demo `lucas` com conquistas que reproduzem nível 47 e as skills da prévia (gerar via ledger), e uma família "Família Lucas" com 3 membros.
- [ ] **Step 1: Teste** `db.test.ts` (requer `pnpm db:up`; pular com `describe.skipIf(!process.env.DATABASE_URL)`): após seed, `prisma.game.count() === 14`, `prisma.guide.findFirst({where:{game:{slug:'hollow-knight'}}})` tem 7 steps; `UserStats` de `lucas` tem `level === 47`.
- [ ] **Step 2:** Rodar e ver falhar. **Step 3:** Schema + migration + seed. **Step 4:** `pnpm db:migrate && pnpm db:seed && pnpm test` PASS.
- [ ] **Step 5: Commit** `feat: database schema and seed data`.

### Task 6: Adaptadores de integração

**Files:**
- Create: `src/lib/integrations/steam/{types,client,fixture,index}.ts`, `src/lib/integrations/igdb/...`, `src/lib/integrations/rawg/...`, `src/lib/integrations/sgdb/...`, `src/lib/integrations/genre-map.ts`, testes `client.test.ts` por fonte e `genre-map.test.ts`, fixtures JSON em `src/lib/integrations/<fonte>/__fixtures__/`.

**Interfaces:**
- Produces:
  - `SteamApi { getPlayerSummary(steamId): Promise<{steamId; personaName; avatarUrl; profilePublic: boolean}>; getOwnedGames(steamId): Promise<{appId:number; playtimeMin:number}[]>; getSchemaForGame(appId): Promise<{apiName; name; description?; iconUrl?; hidden:boolean}[]>; getGlobalAchievementPercentages(appId): Promise<Record<string, number>>; getPlayerAchievements(steamId, appId): Promise<{apiName; unlockedAt: Date | null}[] | 'private'> }`
  - `IgdbApi { findBySteamAppId(appId): Promise<{igdbId; name; summary?; releaseDate?: Date; genres: string[]; themes: string[]; gameModes: string[]; perspectives: string[]; keywords: string[]; aggregatedRating?: number; coverImageId?: string; timeToBeatCompleteSec?: number} | null> }` (Twitch client credentials; endpoints `external_games` + `games` + `game_time_to_beats`, base `https://api.igdb.com/v4`, máx. 4 req/s).
  - `RawgApi { findBySteamAppId(appId, name): Promise<{rawgId; metacritic?: number; playtimeHours?: number} | null> }`
  - `SgdbApi { getArt(appId): Promise<{coverUrl?; heroUrl?; logoUrl?}> }` (base `https://www.steamgriddb.com/api/v2`, header `Authorization: Bearer <key>`, rotas `/grids/steam/{appId}`, `/heroes/steam/{appId}`, `/logos/steam/{appId}`).
  - `getSteam(): SteamApi`, `getIgdb(): IgdbApi`, `getRawg(): RawgApi`, `getSgdb(): SgdbApi` — retornam o cliente real se `hasKey(...)`, senão o fixture.
  - `mapToSkills(input: {genres; themes; gameModes; perspectives; keywords}): SkillId[]` (regras da spec §5; Shooter+First person→fps; Horror+Survival→horror; Role-playing (RPG)→rpg; Platform→plataforma; Strategy/Real Time Strategy (RTS)/Turn-based strategy (TBS)/Tactical→estrategia; Simulator→simulacao; Puzzle→puzzle; Co-operative→coop; keyword soulslike/souls-like→soulslike; keyword roguelike/roguelite→roguelike; sem duplicatas; nunca `sabio`).
- [ ] **Step 1: Testes**: cada cliente real com `fetch` mockado (URL e headers corretos; Steam `getPlayerAchievements` retorna `'private'` quando a resposta tem `playerstats.success === false`); fixtures retornam dados de Hollow Knight (appId 367520); `mapToSkills` com casos da regra acima.
- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** `feat: integration adapters with fixtures and genre mapping`.

### Task 7: Login Steam e sessão

**Files:**
- Create: `src/lib/auth/openid.ts`, `src/lib/auth/session.ts`, `src/app/api/auth/steam/route.ts`, `src/app/api/auth/steam/callback/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/demo/route.ts`, testes `openid.test.ts`, `session.test.ts`.

**Interfaces:**
- Produces: `buildSteamLoginUrl(returnTo: string, realm: string): string`; `verifySteamAssertion(params: URLSearchParams): Promise<string | null>` (POST `check_authentication` em `https://steamcommunity.com/openid/login`; retorna steamId64 extraído de `openid.claimed_id` `https://steamcommunity.com/openid/id/<17 dígitos>`); `createSession(userId: string): Promise<void>` (cookie `gl_session`, httpOnly, sameSite lax, 30 dias, JWT HS256 com `SESSION_SECRET`); `getSessionUser(): Promise<User | null>`; `upsertUserFromSteam(steamId: string): Promise<User>` (usa `getSteam().getPlayerSummary`). Rota `/api/auth/demo` só existe quando `!hasKey('STEAM_API_KEY')` e loga como `lucas`.
- [ ] **Step 1: Testes**: URL contém `openid.mode=checkid_setup`, `openid.return_to` e `openid.realm`; assertion válida (fetch mock responde `is_valid:true`) retorna steamId; `is_valid:false` → null; claimed_id fora do padrão → null; sessão assinada é lida de volta e sessão adulterada → null.
- [ ] **Step 2–4:** falhar → implementar → PASS. Após login, o callback dispara `syncUser` (Task 8) e redireciona para `/jogador/<handle>`.
- [ ] **Step 5: Commit** `feat: Steam OpenID login and sessions`.

### Task 8: Sincronização e progressão

**Files:**
- Create: `src/lib/sync/catalog.ts`, `src/lib/sync/user.ts`, `src/lib/progression/recompute.ts`, `src/app/api/cron/[job]/route.ts`, testes `user.test.ts`, `recompute.test.ts`.

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces: `syncGame(appId: number): Promise<Game | null>` (null se o jogo não tem conquistas; preenche skills via `mapToSkills`, arte, nota, tempo); `syncUser(userId: string): Promise<{ status: 'ok' | 'private'; newUnlocks: number; levelBefore: number; levelAfter: number; skillUps: SkillId[] }>`; `recomputeUser(userId: string): Promise<void>` (reconstrói `SkillProgress` e `UserStats` a partir do ledger, aplica missões, sequência e vocação). Cron: `GET /api/cron/{catalog|rarity|users}` exige header `Authorization: Bearer ${CRON_SECRET}`.
- Regras: histórico anterior ao cadastro conta XP; XP é congelado ao gravar (raridade do momento); `unlockedAt` vem do `unlocktime` da Steam; grava `UserAchievement`; roda `findBursts` e `isSpeedPlatinum` → `suspicious`; cria `XpLedgerEntry` (`source:'achievement'`, `sourceKey: achievementId`) só para não suspeitas, com `upsert` (idempotente); ao completar 100% cria entrada `platinum` (`sourceKey: gameId`); missões concluídas criam entrada `mission`.
- [ ] **Step 1: Testes (com DB de teste)**: rodar `syncUser` duas vezes não altera `totalXp`; 10 desbloqueios em 30s ficam `suspicious` e fora do ledger; perfil privado retorna `{status:'private'}` sem lançar erro; completar todas as conquistas gera 1 entrada `platinum`; cron sem token → 401.
- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** `feat: sync and progression pipeline`.

### Task 9: Páginas de notícias

**Files:**
- Create: `src/app/page.tsx`, `src/app/noticias/[slug]/page.tsx`, `src/components/news/{HeroMain,HeroSide,NewsList,NewsItem,CommunityRanking,DailyQuestCard,DiscordCard,EditorialCard}.tsx`, `src/lib/queries/news.ts`, `src/lib/queries/news.test.ts`

**Interfaces:**
- Produces: `getHomeNews(): Promise<{ hero: ArticleCard; side: ArticleCard[]; latest: ArticleCard[] }>`; `getArticle(slug): Promise<ArticleFull | null>`; `getTopPlayers(limit: number): Promise<{handle; level; totalXp}[]>`.
- Home igual à prévia (destaque, 4 laterais, "Últimas notícias" com filtro por plataforma client-side, sidebar com Discord, missão de hoje do usuário logado, ranking da comunidade, política editorial). Página de artigo: título, meta, selo "Autoria humana", corpo Markdown, card do jogo/guia relacionado.
- [ ] **Step 1: Teste** de `getHomeNews` (DB de teste): `hero.featured === 2`, `side.length === 4`, `latest` ordenado por `publishedAt desc`.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: news home and article pages`.

### Task 10: Catálogo, página do jogo e guia

**Files:**
- Create: `src/app/jogos/page.tsx`, `src/app/jogos/[slug]/page.tsx`, `src/app/jogos/[slug]/guia/page.tsx`, `src/components/games/{GameTile,GameHead,FactsStrip}.tsx`, `src/components/guide/{Overview,Roadmap,AchievementList,AchievementItem,Collectibles,CommunityTips,Revisions,GuideSidebar,Toc}.tsx`, `src/app/jogos/[slug]/guia/actions.ts`, `src/lib/queries/games.ts`, `src/lib/queries/games.test.ts`

**Interfaces:**
- Produces: `listGames(filter: { skill?: SkillId; almost?: boolean; withGuide?: boolean; q?: string }, userId?: string): Promise<GameCard[]>`; `getGame(slug, userId?)`; `getGuide(slug, userId?)` (inclui progresso do usuário por conquista e por etapa). Server Actions: `toggleStep(stepId)`, `voteTip(tipId)` (cria `GuideVote` + ledger `guide_vote` de 25 XP Sábio para o autor da dica, idempotente).
- UI exatamente como a prévia (filtros, ficha de 6 itens, rota com checkbox, filtro de conquistas por categoria, spoilers borrados com toggle, "Como fazer", coletáveis, dicas com voto, revisões, sidebar sticky com progresso, "Este guia treina", sumário). Página do jogo sem guia mostra o bloco "A comunidade está escrevendo este guia". Créditos IGDB/RAWG/SteamGridDB na página do jogo.
- [ ] **Step 1: Testes**: `listGames({almost:true}, lucasId)` só retorna jogos com ≥70% e <100%; `voteTip` duas vezes cria 1 voto e 1 entrada de ledger.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: catalog, game and guide pages`.

### Task 11: Personagem e highscores

**Files:**
- Create: `src/app/jogador/[handle]/page.tsx` (`me` resolve para o usuário logado ou redireciona para login), `src/app/highscores/page.tsx`, `src/components/character/{CharacterCard,XpBar,SkillsWindow,StreakCard,MissionsCard,ActivityFeed,AlmostThere}.tsx`, `src/components/fx/{LevelUpOverlay,Toasts,useSound}.tsx`, `src/app/jogador/[handle]/actions.ts`, `src/lib/queries/players.ts`, `src/lib/queries/players.test.ts`

**Interfaces:**
- Produces: `getCharacter(handle): Promise<Character | null>`; `getHighscores(skill: SkillId | 'geral', limit = 50): Promise<{rank; handle; vocation; level}[]>`; Server Action `syncNow()` (chama `syncUser` para o usuário logado e retorna o resultado para disparar level up/toasts).
- UI igual à prévia: nível grande, barra de XP, estatísticas, sequência com semana, missões, janela de skills estilo Tibia, "Quase lá", atividade. Level up: overlay "Você avançou do nível X para o nível Y." com som (WebAudio, botão de mudo) e toasts por conquista/skill. Perfil privado mostra aviso com link para as configurações de privacidade da Steam. Highscores com seletor de skill e linha do usuário destacada.
- [ ] **Step 1: Testes**: `getHighscores('geral')` ordenado por nível desc; usuário com `profilePublic=false` não aparece; `getCharacter('lucas').level === 47`.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: character sheet and highscores`.

### Task 12: Família GAMELOG

**Files:**
- Create: `src/app/familia/page.tsx`, `src/app/familia/convite/[token]/page.tsx`, `src/app/familia/actions.ts`, `src/lib/family/service.ts`, `src/lib/family/service.test.ts`, `src/components/family/{FamilyLibrary,FamilyRanking,FamilyAlmost,InvitePanel}.tsx`

**Interfaces:**
- Produces: `createFamily(ownerId, name): Promise<Family>`; `createInvite(familyId, byUserId): Promise<{ token; url; expiresAt }>` (7 dias; só membros); `acceptInvite(token, userId): Promise<{ ok: true } | { ok: false; reason: 'expired' | 'used' | 'already_in_family' | 'not_found' | 'full' }>` (máx. 6 membros); `leaveFamily(userId)`; `getFamilyLibrary(familyId): Promise<{ game: GameCard; owners: {handle}[]; bestProgress: {handle; pct} }[]>`; `getFamilyRanking(familyId, skill | 'geral')`.
- UI: biblioteca conjunta com filtros "Quem tem" e "Ninguém jogou ainda", ranking da família, "Quase lá da família", painel de convite com botão Copiar link. Mensagens: expirado "Este convite expirou. Peça um novo link.", usado "Este convite já foi usado.", já em família "Você já faz parte de uma família. Saia dela antes de entrar em outra.".
- [ ] **Step 1: Testes** cobrindo cada `reason` de `acceptInvite`, limite de 6, e biblioteca conjunta unindo jogos de 2 membros sem duplicar.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: GAMELOG family groups`.

### Task 13: Verificação final do plano

- [ ] **Step 1:** `pnpm lint && pnpm test && pnpm build` sem erros.
- [ ] **Step 2:** Subir `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev`, entrar via `/api/auth/demo`, navegar: `/`, `/jogos`, `/jogos/hollow-knight/guia`, `/jogador/me`, `/highscores`, `/familia`. Todas respondem 200 sem erros no console.
- [ ] **Step 3:** `README.md` em `app/` com como rodar, variáveis e como ligar chaves reais.
- [ ] **Step 4: Commit** `docs: run instructions`.
