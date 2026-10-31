# Robô de Notícias do Tralked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone robot in `ROBO NOTICIAS/` that follows dozens of gaming sources and writes its own cross-sourced articles in Portuguese with Claude. It publishes them to tralked.com through the bot API: about 750 backdated articles covering the last 3 months, then one article per hour from 06h to 00h, at most 15 per day.

**Architecture:** Part A changes the site (`app/`): the "Equipe Tralked" byline, three new categories, a backdated `publishedAt`, archiving via the API, two read endpoints and a key-creation script. Part B is a separate Node/TypeScript project with three commands, run by the Windows Task Scheduler and sharing a local SQLite state:
- `coleta`, every 30 min: collect, triage with Haiku, group into stories, rank and queue.
- `publica`, hourly: write with Opus, fact-check with Haiku, publish through the API.
- `retroativo`: the same pipeline over sitemaps, through the Batches API, with backdated dates.

**Tech Stack:**
- Site: Next 16.4, Prisma 7, zod 4, vitest.
- Robot: Node 24 (`node:sqlite`), TypeScript, `tsx`, vitest, zod 4, `@anthropic-ai/sdk` (structured outputs with `zodOutputFormat`, Batches), `fast-xml-parser`, `@mozilla/readability` and `linkedom`.

**Spec:** `docs/superpowers/specs/2026-10-31-tralked-robo-noticias-design.md`

## Global Constraints

- Site constraints from `.superpowers/sdd/2026-10-31-tralked-plano-2/global-constraints.md` apply to Part A:
  - pt-BR UI; code and commits in English; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - zod on every input; never render raw HTML; axe has no serious/critical violations.
  - Each worktree uses its own DB `gamelog_<task>`. Never touch `gamelog` or `gamelog_dev`.
  - `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` is green at the end of every site task.
- Part A needs **no Prisma migration** (categories are strings; `publishedAt` already exists).
- Robot: `pnpm exec tsc --noEmit && pnpm test` is green at the end of every robot task. Tests never call Anthropic or the real site: the client and `fetch` are injected and mocked.
- The robot writes to the site **only** through `/api/v1/*`, never to its DB.
- Models:
  - Writer: `claude-opus-5-5` (config `MODEL_WRITER`).
  - Fast: `claude-haiku-5-5` (config `MODEL_FAST`).
  - Live writer calls use `client.beta.messages` with `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`. Batch calls omit `fallbacks`, because the Batches API rejects it.
  - Check `stop_reason === "refusal"` before reading content.
  - Thinking: omit `thinking` (Opus 5.5 is adaptive). Set `output_config.effort` explicitly: `"high"` for the writer, `"low"` for triage, clustering and the checker.
- Prices in USD per 1M tokens (input/output):
  - opus-5-5: 4 / 20.
  - sonnet-5-5: 2 / 10.
  - haiku-5-5: 0.10 / 0.50.
  - Cache read is 0.1× input; cache write is 1.25× input; batch is 0.5× everything.
- Schedule, in timezone `America/Sao_Paulo`:
  - Publishing slots are hours 06–23, so at most 18 slots a day.
  - At most `MAX_PER_DAY = 15` articles a day; PATCH updates do not count.
  - Jitter: wait 0–12 min before publishing in a slot.
  - Collection runs every 30 min, 24 h a day.
- Budgets: `DAILY_BUDGET_USD = 5` for live work, `BACKFILL_BUDGET_USD = 70` for the backfill, tracked separately.
- Backfill: `BACKFILL_DAYS = 90` and `BACKFILL_TOTAL = 750`. Times are drawn uniformly in 06:00–23:59 local on the story's date. Backfill articles are published oldest first with `featured = 0`.
- Editorial copy fixed by the spec:
  - Byline `Equipe Tralked`.
  - Section titles `Em 3 pontos`, `No Tralked`, `Fontes`.
  - Audience labels `Pra quem joga de boa` and `Pra quem caça 100%`.
  - Update note `Atualizado às HH:MM`.
- Robot secrets live in `ROBO NOTICIAS/.env`, which is gitignored. Robot state lives in `ROBO NOTICIAS/data/`, also gitignored.

## Review Focus

1. **The same fact arrives from 5 sources across two collection runs.** Expected: one story and one article, never two. The live and backfill runs must never publish the same story twice; resuming either command must not duplicate. Tests in Tasks 9, 12 and 13.
2. **A source is down, returns HTML instead of XML, or times out.** Expected: that source is skipped and logged, the run continues, and after 24 h of failures an alert fires. Tests in Tasks 7 and 14.
3. **The model returns text that the site would refuse** (raw HTML, an `http:` link, a game missing from the catalog, an `apiName` that does not exist). Expected: the assembler and the API client strip or repair it (unknown games are dropped, unknown achievements are removed), and a 422 from the site never loops. Tests in Tasks 10 and 11.
4. **The clock is near a boundary** (23:58, 00:03, 05:59) or the day's count is already 15. Expected: no publish outside 06–23, no 16th article, and a "bomb" story at 03:00 still waits for the day cap but is allowed outside the slot. The day is computed in São Paulo time, not UTC. Tests in Task 12.
5. **The budget runs out mid-run or the `PAUSADO` file exists.** Expected: nothing more is written or published, already-paid results are kept, and an alert fires. The backfill budget never eats into the live budget. Tests in Tasks 8 and 12.

---

## Part A — Site (`app/`)

### Task 1: Byline "Equipe Tralked" without robot badge

**Files:**
- Modify: `app/src/lib/queries/news.ts` (`authorLabel`)
- Modify: `app/src/app/noticias/[slug]/page.tsx:140-160`
- Modify: `app/src/components/news/NewsItem.tsx`, `app/src/components/news/ArticleTags.tsx` (only if they show a bot badge)
- Modify: `app/src/app/desenvolvedores/page.tsx:~252` (the copy about the badge)
- Test: `app/src/lib/queries/news.test.ts`

**Interfaces:**
- Produces: `export const BOT_BYLINE = "Equipe Tralked"` and `authorLabel(source, handle)`, which returns `BOT_BYLINE` when `source === "bot"`.

- [ ] **Step 1: Failing tests** in `news.test.ts`:
  - `authorLabel("bot", "Robô Notícias") === "Equipe Tralked"`.
  - `authorLabel("editorial", "mrdead") === "@mrdead"`.
  - A bot article card has `authorLabel === "Equipe Tralked"` and `humanAuthored === false`.
- [ ] **Step 2:** Run `pnpm vitest run src/lib/queries/news.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Change `authorLabel`.
  - In the article page, remove the `article.source === "bot"` branch that renders "Gerado por robô…". Keep the `humanAuthored` "Autoria humana" branch for editorial articles only.
  - JSON-LD already emits `Organization` for bots, which now gets the name "Equipe Tralked".
  - Rewrite the `/desenvolvedores` sentence to say that robot news is signed "Equipe Tralked".
  - The admin (`/admin/noticias`) keeps showing the "Robôs" origin unchanged.
  - The internal author handle `Robô <key>` (`botAuthorHandle`) does not change.
- [ ] **Step 4:** Run the news tests, `pnpm vitest run src/app/api/v1/api.test.ts`, and an e2e grep for "Gerado por robô" in `e2e/`. Update any assertion that expects the old badge.
- [ ] **Step 5:** Run lint, tsc, test and build. Then commit: `feat(news): sign robot articles as Equipe Tralked without robot badge`.

### Task 2: Categories MERCADO, ENTRETENIMENTO, TECNOLOGIA

**Files:**
- Modify: `app/src/lib/api/article-schema.ts:7`
- Modify: `app/src/lib/queries/news.ts:22-29`
- Modify: `app/src/lib/api/openapi.ts` (enum, if listed there)
- Test: `app/src/lib/queries/news.test.ts`, `app/src/app/api/v1/api.test.ts`

**Interfaces:**
- Produces: `ARTICLE_CATEGORIES = ["GAMES", "GUIAS", "COMUNIDADE", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"]`.
- Produces: `CATEGORIES` gains `{ id: "MERCADO", slug: "mercado", label: "Mercado" }`, `{ id: "ENTRETENIMENTO", slug: "entretenimento", label: "Entretenimento" }` and `{ id: "TECNOLOGIA", slug: "tecnologia", label: "Tecnologia" }`.

- [ ] **Step 1: Failing tests:**
  - `categoryFromSlug("mercado") === "MERCADO"`, and the same for the other two.
  - `buildNewsTabs` returns tabs `ultimas, games, guias, comunidade, mercado, entretenimento, tecnologia`.
  - API: a POST with `category: "TECNOLOGIA"` returns 201.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** The admin editor (`ArticleEditor.tsx`) and `/noticias` read these lists, so no other change is needed. Check that the tab strip in `NewsTabs` still scrolls horizontally on mobile with 7 tabs (it already uses `overflow-x: auto`).
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run lint, tsc, test and build.
- [ ] **Step 5:** Commit `feat(news): add Mercado, Entretenimento and Tecnologia categories`.

### Task 3: Backdated `publishedAt` and archiving through the bot API

**Files:**
- Modify: `app/src/lib/api/article-schema.ts`
- Modify: `app/src/lib/api/articles.ts` (`createArticle`, `updateArticle`)
- Modify: `app/src/lib/api/openapi.ts`, `app/src/app/desenvolvedores/page.tsx` (document both)
- Test: `app/src/app/api/v1/api.test.ts`

**Interfaces:**
- Produces POST field `publishedAt?: string`, an ISO 8601 datetime with an offset. Rules:
  - Only accepted with the `publish` scope and a resulting status of `published`.
  - Must be ≤ now + 5 min and ≥ now − `MAX_BACKDATE_DAYS` (= 120).
  - Sets both `publishedAt` and `firstPublishedAt`.
- Produces: PATCH `status` also accepts `"archived"` (publish scope only), so `ARTICLE_STATUSES` for PATCH becomes `["review", "published", "archived"]`. POST still allows only review/published.

- [ ] **Step 1: Failing tests:**
  - A publisher sending `publishedAt` 30 days ago gets 201. `GET /api/v1/articles/{id}` returns that `publishedAt`, and the article appears in `/noticias` ordered by that date.
  - A writer (no publish scope) sending `publishedAt` gets 403 on `/publishedAt`.
  - `publishedAt` 200 days ago gets 422 on `/publishedAt`. So does one 1 h in the future, and `"ontem"`.
  - `publishedAt` together with `status: "review"` gets 422.
  - A publisher sending PATCH `{status: "archived"}` gets 200, and the article disappears from the public list. A writer sending the same gets 403.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `publishedAt` to `articlePayloadSchema` with `z.iso.datetime({ offset: true })`. Apply the range and the scope/status rules in `createArticle`, returning `fail("validation_failed" | "forbidden", …, [{ path: "/publishedAt", … }])`.
  - Archiving keeps `invalidateNews`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run lint, tsc, test and build.
- [ ] **Step 5:** Commit `feat(api): backdated publishedAt and archiving for publish-scope bots`.

### Task 4: Read endpoints for robots

**Files:**
- Modify: `app/src/app/api/v1/articles/route.ts` (add `GET`)
- Create: `app/src/lib/api/feed.ts`
- Create: `app/src/app/api/v1/games/[slug]/insights/route.ts`
- Create: `app/src/lib/api/insights.ts`
- Modify: `app/src/lib/api/openapi.ts`
- Test: `app/src/app/api/v1/api.test.ts`

**Interfaces:**
- Produces `GET /api/v1/articles?since=<ISO>&limit=<1..200, default 100>`. Any active key may call it. It returns `{ articles: { id, slug, title, category, publishedAt, source: "editorial" | "bot", games: string[] /* slugs */ }[] }`: only `published` articles, from **any** author, newest first, with `publishedAt >= since` (default: now − 7 days).
- Produces `GET /api/v1/games/{slug}/insights`. Any active key may call it; an unknown slug returns 404. It returns:
  ```ts
  {
    game: { slug, name, releaseDate: string | null, platforms: string[], achievementCount: number, timeToBeatCompleteMin: number | null },
    tralked: { players: number, avgPlaytimeMin: number | null },
    rarest: { platform: string, apiName: string, name: string, globalPct: number }[],
  }
  ```
  - `players` is the number of distinct users with a `UserGame` row for the game.
  - `avgPlaytimeMin` is the average `playtimeMin` over rows with `playtimeMin > 0`. It is null when fewer than 3 such users exist, which also protects privacy.
  - `rarest` holds the 5 achievements with the lowest non-null `globalPct`, excluding `hidden` ones.
  - Aggregates only; no user ids or handles.

- [ ] **Step 1: Failing tests:**
  - The feed lists an editorial and a bot article published in the last 7 days, and excludes drafts, archived articles and anything older than `since`.
  - `limit=500` returns 400 on `?limit`.
  - Without a key, 401.
  - Insights: with 2 players `avgPlaytimeMin` is null; with 3 players it is their average; `rarest` is sorted ascending with at most 5 entries and no hidden ones; an unknown slug returns 404.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `listRecentArticles(params: URLSearchParams)` in `feed.ts` and `gameInsights(slug: string)` in `insights.ts`, following the `searchGames` style (return `{ ok: false, param, message }` for bad params).
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run lint, tsc, test and build.
- [ ] **Step 5:** Commit `feat(api): recent-articles feed and game insights for robots`.

### Task 5: Script to create an API key

**Files:**
- Create: `app/scripts/create-api-key.ts`
- Modify: `app/package.json` (script `"api:key": "tsx scripts/create-api-key.ts"`)
- Modify: `app/README.md` (one paragraph)

**Interfaces:**
- Consumes: `createApiKey({ name, scopes })` from `@/lib/api/keys` and `requireDatabaseUrl()` from `scripts/lib/run`.
- Produces: `DATABASE_URL=… pnpm api:key "<name>" articles:write publish`. It prints the secret once, to the terminal only (same rule as `invite-user.ts`), and exits 2 on an unknown scope.

- [ ] **Step 1:** Write the script the same way as `scripts/invite-user.ts`.
- [ ] **Step 2:** Run it against the task DB with `pnpm api:key "Teste" articles:write publish`. Expected: it prints `tk_live_…`. With a bad scope, `pnpm api:key x foo` exits with code 2.
- [ ] **Step 3:** Commit `feat(scripts): api:key to create a bot key from the terminal`.

---

## Part B — Robot (`ROBO NOTICIAS/`)

Layout (one responsibility per file):

```
ROBO NOTICIAS/
  package.json  tsconfig.json  vitest.config.ts  .env.example  .gitignore  README.md
  config/fontes.json            # sources
  prompts/estilo.md             # editorial manual (system prompt, cached)
  scripts/instalar-tarefas.ps1  # Windows Task Scheduler
  src/
    config.ts      # env + fontes.json (zod)
    db.ts          # node:sqlite schema + typed queries
    clock.ts       # São Paulo day/slot helpers
    url.ts         # URL normalization, content hash
    collect/rss.ts collect/sitemap.ts collect/listing.ts collect/extract.ts collect/index.ts
    ai/client.ts   # Anthropic wrapper, pricing, budget
    ai/triage.ts ai/cluster.ts ai/writer.ts ai/checker.ts
    rank.ts        # story score, bomb, expiry
    assemble.ts    # writer output -> API payload blocks
    tralked.ts     # site API client
    alerts.ts      # log, daily summary, e-mail
    commands/coleta.ts commands/publica.ts commands/retroativo.ts commands/despublicar.ts commands/resumo.ts
  test/fixtures/   # feeds, sitemaps, pages
```

### Task 6: Project scaffold, config and SQLite state

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `config/fontes.json`, `src/config.ts`, `src/db.ts`, `src/clock.ts`, `src/url.ts`, `test/db.test.ts`, `test/clock.test.ts`, `test/url.test.ts`

**Interfaces:**
- Produces `loadConfig(env = process.env): Config`. The zod-validated fields are:
  - `ANTHROPIC_API_KEY`, `TRALKED_API_URL` (default `https://tralked.com`), `TRALKED_API_KEY`.
  - `MODEL_WRITER` (default `claude-opus-5-5`), `MODEL_FAST` (default `claude-haiku-5-5`).
  - `DAILY_BUDGET_USD = 5`, `BACKFILL_BUDGET_USD = 70`, `MAX_PER_DAY = 15`, `SLOT_FIRST_HOUR = 6`, `SLOT_LAST_HOUR = 23`.
  - `BACKFILL_DAYS = 90`, `BACKFILL_TOTAL = 750`.
  - `RESEND_API_KEY?`, `ALERT_EMAIL?`, `DATA_DIR = "./data"`.
- Produces `loadSources(path = "config/fontes.json"): Source[]`, where:
  ```ts
  type Source = { id: string; name: string; kind: "rss" | "listing"; url: string;
    tier: "oficial" | "portal" | "outro"; category: "GAMES" | "MERCADO" | "ENTRETENIMENTO" | "TECNOLOGIA";
    gamingFilter: boolean;          // true: keep only items related to games (Entretenimento/Tecnologia sources)
    backfill?: { kind: "sitemap"; url: string }; listingSelector?: string; active: boolean };
  ```
- Produces `openDb(dir: string): Db`, using `node:sqlite` `DatabaseSync` with WAL and `PRAGMA foreign_keys=ON`. The tables are:
  - `items(id INTEGER PK, url TEXT UNIQUE, source_id, title, summary, published_at TEXT, fetched_at, content_hash, text, status TEXT /*new|triaged|dropped|clustered*/, triage_json)`.
  - `stories(id INTEGER PK, key TEXT UNIQUE, headline, category, score REAL, bomb INTEGER, rumor INTEGER, games_json, first_seen_at, last_item_at, status TEXT /*open|queued|written|published|dropped|expired*/, mode TEXT /*live|backfill*/, story_date TEXT)`.
  - `story_items(story_id, item_id, PRIMARY KEY(story_id,item_id))`.
  - `articles(id INTEGER PK, story_id UNIQUE, site_id, slug, published_at, payload_json, status TEXT /*ready|published|failed|archived*/, updated_at, parent_article_id)`.
  - `spend(id INTEGER PK, at TEXT, bucket TEXT /*live|backfill*/, purpose, model, usd REAL)`.
  - `source_health(source_id PK, last_ok_at, last_error_at, last_error)`.
  - `alerts(id INTEGER PK, at, kind, message, emailed INTEGER)`.
- Produces typed helpers on `Db`: `insertItemIfNew`, `itemsByStatus`, `upsertStory`, `attachItem`, `storiesByStatus`, `recordSpend(bucket, purpose, model, usd)`, `spentToday(bucket, now)`, `spentTotal(bucket)`, `publishedCountOn(localDay)`, `saveArticle`, `markArticle`.
- Produces in `clock.ts`, all based on `Intl.DateTimeFormat` with `timeZone: "America/Sao_Paulo"`:
  - `localDay(d: Date): string` ("YYYY-MM-DD").
  - `localHour(d: Date): number`.
  - `inSlotWindow(d, first = 6, last = 23): boolean`.
  - `randomTimeOn(day: string, rand = Math.random): Date`, uniform in 06:00–23:59 local.
- Produces in `url.ts`:
  - `normalizeUrl(u: string): string`: lowercases the host, drops `utm_*`, `fbclid`, `gclid` and the hash, and strips a trailing slash except at the root.
  - `contentHash(text: string): string`: sha256 of the lowercased text with whitespace collapsed.

- [ ] **Step 1: Scaffold.**
  - Run `pnpm init`, then add the deps: `@anthropic-ai/sdk zod fast-xml-parser @mozilla/readability linkedom dotenv`.
  - Dev deps: `typescript tsx vitest @types/node`.
  - Set `"type": "module"`, `engines.node >= 24`.
  - Scripts: `coleta`, `publica`, `retroativo`, `despublicar`, `resumo`, each `tsx src/commands/<x>.ts`, plus `test` and `typecheck`.
  - `.gitignore`: `.env`, `data/`, `node_modules/`.
  - Before writing code, check the current `@anthropic-ai/sdk` exports for `zodOutputFormat` and `beta.messages.parse` via Context7.
- [ ] **Step 2: Fill `config/fontes.json`** with the spec's source list. Verify every URL with a real fetch and record what was verified in the README.
  - RSS, live: IGN, GameSpot, Eurogamer, PC Gamer, Polygon, VGC, Rock Paper Shotgun, GamesIndustry.biz, The Verge games, Kotaku, Digital Foundry, PlayStation Blog, Xbox Wire, Nintendo news, Rockstar Newswire, Steam news, Epic Games Store news.
  - Publisher press/IR pages: Take-Two, Sony, Nintendo IR, Microsoft Gaming, Ubisoft, EA, Capcom, Bandai Namco, Square Enix, CD Projekt, Embracer, as `listing` when no RSS exists.
  - Alinea Analytics as `listing`; Circana if public.
  - 3–5 Brazilian outlets.
  - Entertainment/tech sections with `gamingFilter: true`.
  - Add `backfill.sitemap` wherever a dated sitemap exists.
- [ ] **Step 3: Failing tests.**
  - `url.test.ts`: `normalizeUrl("https://IGN.com/a/?utm_source=x#c") === "https://ign.com/a"`.
  - `clock.test.ts`:
    - `localDay(new Date("2026-11-01T02:30:00Z")) === "2026-10-31"` (that is 23:30 in São Paulo).
    - `inSlotWindow` is false at 05:59 and 00:03 local, and true at 06:00 and 23:59.
    - `randomTimeOn("2026-08-10", () => 0)` is 06:00 local, and with `() => 0.9999` it is 23:59 local.
  - `db.test.ts`: `insertItemIfNew` returns false for a URL that is equal after normalization; `spentToday("live")` sums only today's (local) live rows; `publishedCountOn` counts only `published` articles of that local day.
  - `config.test.ts`: the defaults apply; a missing `ANTHROPIC_API_KEY` throws a message naming it; `fontes.json` with an unknown category is rejected.
- [ ] **Step 4:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 5:** Implement until it passes. Run `pnpm typecheck`.
- [ ] **Step 6:** Commit `feat(robo): scaffold, config, sources and SQLite state`.

### Task 7: Collectors and text extraction

**Files:** `src/collect/rss.ts`, `src/collect/sitemap.ts`, `src/collect/listing.ts`, `src/collect/extract.ts`, `src/collect/index.ts`, `test/collect.test.ts`, fixtures in `test/fixtures/`

**Interfaces:**
- Produces `type RawItem = { url: string; title: string; summary: string | null; publishedAt: Date | null; sourceId: string }`.
- Produces `parseFeed(xml: string, sourceId: string): RawItem[]`, for RSS 2.0 and Atom. The summary is stripped of HTML and truncated to 500 chars.
- Produces `parseSitemap(xml: string, sourceId: string, from: Date, to: Date): { items: RawItem[]; children: string[] }`. It supports:
  - a sitemap index (children are returned, filtered by `lastmod` when present);
  - `urlset` with `lastmod`;
  - the Google News extension (`news:title`, `news:publication_date`).
  When there is no title, the title is derived from the last URL segment, de-slugified.
- Produces `parseListing(html: string, baseUrl: string, selector: string, sourceId: string): RawItem[]`, using `linkedom` and absolute URLs.
- Produces `extractText(html: string, url: string): { title: string | null; text: string; publishedAt: Date | null } | null`. It uses Readability over a linkedom document and caps the text at 20,000 chars. `publishedAt` comes from `article:published_time` or JSON-LD `datePublished`.
- Produces `collectLive(sources, fetchFn = fetch, now = new Date()): Promise<{ items: RawItem[]; failures: { sourceId: string; error: string }[] }>`. It runs with a concurrency of 6, a 20 s timeout per request, and the User-Agent `TralkedBot/1.0 (+https://tralked.com)`. A failing source never throws.

- [ ] **Step 1: Failing tests,** using fixtures (`rss2.xml`, `atom.xml`, `sitemap-index.xml`, `news-sitemap.xml`, `listing.html`, `article.html`, `not-xml.html`):
  - `parseFeed` returns the right titles, URLs and dates, with the summary free of HTML.
  - `parseSitemap` keeps only items inside `[from, to]` and returns the children of the index.
  - `parseListing` resolves relative links.
  - `extractText` returns the article body and not the menu text, plus the `published_time`.
  - `collectLive`: a source returning `not-xml.html` and one that times out end up in `failures`, while the other sources still return items.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass, then run `pnpm typecheck`.
- [ ] **Step 4:** Commit `feat(robo): RSS, sitemap and listing collectors with text extraction`.

### Task 8: Claude client wrapper, pricing and budget

**Files:** `src/ai/client.ts`, `test/ai-client.test.ts`

**Interfaces:**
- Produces `PRICES: Record<string, { in: number; out: number }>`, in USD per 1M tokens, from Global Constraints.
- Produces `costUsd(model, usage: { input_tokens; output_tokens; cache_read_input_tokens?; cache_creation_input_tokens? }, batch = false): number`.
- Produces `class BudgetExceededError extends Error` and `class RefusalError extends Error`.
- Produces:
  ```ts
  createAi(deps: { client: Anthropic; db: Db; config: Config; now?: () => Date }): {
    structured<T>(opts: { bucket: "live" | "backfill"; purpose: string; model: string;
      effort: "low" | "medium" | "high"; system: string /* cached */; user: string; schema: z.ZodType<T>;
      maxTokens?: number; fallbacks?: boolean }): Promise<T>;
    batchRequest(opts: same minus bucket/fallbacks, plus customId: string): Anthropic.Messages.Batches.BatchCreateParams.Request;
    recordBatchUsage(model: string, usage, purpose: string): void;   // bucket backfill, batch pricing
    assertBudget(bucket: "live" | "backfill"): void;                  // throws BudgetExceededError
  }
  ```
  `structured` does the following, in order:
  1. Calls `assertBudget` first.
  2. Sends `system` as a text block with `cache_control: { type: "ephemeral" }`.
  3. Uses `output_config: { effort, format: zodOutputFormat(schema) }`.
  4. When `fallbacks` is set, calls `client.beta.messages.parse` with the fallback beta and `fallbacks: "default"`; otherwise it calls `client.messages.parse`.
  5. Throws `RefusalError` on `stop_reason === "refusal"`.
  6. Records the spend.
  7. Throws when `parsed_output` is null.
  - `maxTokens` defaults to 16000.
  - The live budget is `spentToday("live") >= DAILY_BUDGET_USD`; the backfill budget is `spentTotal("backfill") >= BACKFILL_BUDGET_USD`.

- [ ] **Step 1: Failing tests,** with a fake client object:
  - `costUsd("claude-opus-5-5", {input_tokens: 1e6, output_tokens: 1e6}) === 24`, and the same with `batch` is 12.
  - Cache reads are priced at 0.1×.
  - `structured` records spend in the right bucket.
  - A refusal throws `RefusalError` and still records spend.
  - Once the day's live spend reaches 5, `structured` throws `BudgetExceededError` before calling the client, while backfill calls are still allowed.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass, then run `pnpm typecheck`.
- [ ] **Step 4:** Commit `feat(robo): Claude wrapper with structured outputs, pricing and budgets`.

### Task 9: Triage, clustering and ranking

**Files:** `src/ai/triage.ts`, `src/ai/cluster.ts`, `src/rank.ts`, `test/triage-cluster.test.ts`, `test/rank.test.ts`

**Interfaces:**
- Consumes: `Ai.structured` and `Db`.
- Produces `triageItems(ai, items: { id: number; title: string; summary: string | null; source: Source }[], bucket): Promise<Triage[]>`. Items are sent in chunks of 50 per Haiku call, at effort `low`. The type is:
  ```ts
  type Triage = { id: number; keep: boolean; category: "GAMES" | "MERCADO" | "ENTRETENIMENTO" | "TECNOLOGIA";
    games: string[]; companies: string[]; rumor: boolean; importance: number /*0-100*/; headlinePt: string };
  ```
  The prompt states that `keep` is false for deals/coupons, listicles, reviews of non-gaming products, sponsored content, and, for `gamingFilter` sources, anything not related to games.
- Produces `clusterItems(ai, newItems: { id: number; headlinePt: string; games: string[] }[], openStories: { key: string; headline: string; games: string[] }[], bucket): Promise<{ id: number; storyKey: string | null; newHeadline?: string }[]>`. Only stories whose `last_item_at` is within 72 h count as open. A null `storyKey` means a new story.
- Produces in `rank.ts`:
  - `TIER_WEIGHT = { oficial: 20, portal: 10, outro: 0 }`.
  - `storyScore(s: { maxImportance: number; tiers: ("oficial" | "portal" | "outro")[]; sourceCount: number; rumor: boolean }): number`, equal to `maxImportance + max tier weight + min(sourceCount - 1, 4) * 5 - (rumor ? 15 : 0)`.
  - `isBomb(s): boolean`, true when `maxImportance >= 90 && sourceCount >= 3 && tiers.some(t => t !== "outro")`.
  - `isPublishable(s): boolean`. A story is publishable when it has an `oficial` source, or at least 2 sources, or exactly one `portal` source with `rumor === false`. A rumor needs at least one `portal` or `oficial` source.
  - `isExpired(s: { score: number; firstSeenAt: Date }, now: Date): boolean`, true after 24 h when `score < 70`, and after 48 h otherwise.

- [ ] **Step 1: Failing tests:**
  - `rank.test.ts` covers every formula and edge: exactly 24 h, a score of 69 vs 70, a rumor with a single `outro` source that is not publishable, and a bomb with 2 sources that is not a bomb.
  - `triage-cluster.test.ts`, with mocked `ai.structured`:
    - Five items about the same fact, delivered in two calls, end up in **one** story (the second call is given the first call's open story).
    - An item for an unknown story key is treated as new.
    - A dropped item never reaches clustering.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass.
- [ ] **Step 4:** Commit `feat(robo): triage, story clustering and ranking`.

### Task 10: Editorial manual, writer, assembler and checker

**Files:** `prompts/estilo.md`, `src/ai/writer.ts`, `src/assemble.ts`, `src/ai/checker.ts`, `test/assemble.test.ts`, `test/writer-checker.test.ts`

**Interfaces:**
- `prompts/estilo.md` is the system prompt and is cached. It carries, in pt-BR, the spec's whole "Identidade editorial" section:
  - The audience: casual players and 100% hunters.
  - The voice.
  - **Neutrality, with the gamer/consumer as the only side.** It lists the spec's examples (price rises, DRM, servers shut down, games delisted, aggressive microtransactions, layoffs) and always includes the company's position.
  - **Never invent; rumors labeled "segundo X, sem confirmação oficial".**
  - No copying: quotes are short, in quotes and attributed.
  - No clickbait.
  - A neutral closing question.
  - "No Tralked" may use only the insights data given in the prompt, plus the sources.
  - When nothing is useful, `noTralked` is null.
- Produces the writer schema (zod), which the model fills:
  ```ts
  type Draft = { title: string /*<=110*/; subtitle: string /*<=220*/; excerpt: string /*<=280*/;
    pontos: [string, string, string]; corpo: ({ h: string } | { p: string } | { lista: string[] } |
      { citacao: string; autor: string } | { tabela: { cabecalho: string[]; linhas: string[][] } })[];
    noTralked: null | { casual: string | null; cacador: string | null; conquistas: string[] /* apiNames from insights */ };
    pergunta: string; category: Category; platforms: ("PC" | "PLAYSTATION" | "XBOX" | "NINTENDO")[];
    games: string[] /* slugs from the candidates given */; imageLabel: string /*<=60*/; rumor: boolean };
  ```
- Produces `type StoryForWriting = { id: number; headline: string; category: Category; rumor: boolean; sources: { name: string; tier: Source["tier"]; url: string; publishedAt: Date | null; text: string }[]; candidates: { slug: string; name: string; insights: Insights | null }[]; previous?: { title: string; blocksText: string } }`.
- Produces `writePrompt(story: StoryForWriting): string`. It is the user message, holding:
  - The story's sources, each as `<fonte nome tier url data>text</fonte>`.
  - The candidate games with their insights.
  - Today's date.
  - For an update, the previous article plus the instruction "acrescente os fatos novos".
- Produces `writeDraft(ai, story, bucket): Promise<Draft>`, using `MODEL_WRITER` at effort `high` with `fallbacks: true` when live.
- Produces `assemble(draft: Draft, story: { sources: { name: string; url: string }[] }, opts: { insights: Map<slug, Insights>; updatedAt?: Date }): ArticlePayload`. The block order is fixed:
  1. When `updatedAt` is set: a paragraph `*Atualizado às HH:MM*`, in local time.
  2. Heading 2 `Em 3 pontos`, then a list of the 3 `pontos`.
  3. The `corpo` blocks, mapped to `heading`, `paragraph`, `list`, `quote`, `table`.
  4. When `noTralked` is set: heading 2 `No Tralked`, a callout `info` with `**Pra quem joga de boa:** …` when present, a callout `info` with `**Pra quem caça 100%:** …` when present, and an `achievement` block for each `conquistas` apiName that **exists** in the insights `rarest`, at most 3.
  5. A paragraph with the `pergunta`, in italics.
  6. Heading 2 `Fontes`, then a list of `[name](url)`, https only, deduplicated by URL.

  `assemble` sanitizes all text:
  - It removes anything matching `<[a-zA-Z!/?]`.
  - It drops markdown links whose target is not https.
  - It truncates to the API limits: title 200, subtitle 300, excerpt 300, paragraph 5000, list item 1000, callout 2000, table cell 500.
  - It drops games not in the candidates.
  - `status: "published"`.
- Produces `checkDraft(ai, draft: Draft, sourcesText: string, bucket): Promise<{ ok: boolean; problems: string[] }>`. It uses Haiku at effort `low` and checks only numbers, dates, names, quotes, and claims that appear in no source.
- Produces `writeAndCheck(ai, story, bucket): Promise<{ ok: true; draft: Draft } | { ok: false; problems: string[] }>`. On a failed check it rewrites **once**, appending the problems to the user message, and checks again.

- [ ] **Step 1: Failing tests:**
  - `assemble` produces the exact order above.
  - Without `noTralked`, no `No Tralked` heading is produced.
  - An apiName that is not in the insights is dropped.
  - `<script>` and `[x](http://a)` are stripped.
  - Sources are deduplicated.
  - `updatedAt` produces the note `*Atualizado às 14:05*` for `2026-10-31T17:05:00Z`.
  - The output validates against a **copy** of the site's `articlePayloadSchema` rules. The test imports `app/src/lib/api/article-schema.ts` through a relative path when that resolves; otherwise it uses a minimal local mirror of the block shapes.
  - `writeAndCheck`, with mocks: a failing check rewrites exactly once, and if it fails again it returns `ok: false` with the problems.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Write `prompts/estilo.md` and implement until the tests pass.
- [ ] **Step 4: Manual quality run** (spends about US$ 0.20; needs the real key). Write one draft from a fixture story with 3 real sources via `pnpm tsx src/ai/writer.ts --amostra test/fixtures/story.json`. It must print the payload and must not publish. Read the result against the spec's editorial section and adjust `estilo.md` once if needed.
- [ ] **Step 5:** Commit `feat(robo): editorial manual, writer, fact-checker and payload assembler`.

### Task 11: Tralked API client

**Files:** `src/tralked.ts`, `test/tralked.test.ts`

**Interfaces:**
- Produces `createTralked({ baseUrl, key, fetchFn = fetch })`, which exposes:
  - `findGame(name: string): Promise<{ slug: string; name: string } | null>`. It calls `GET /api/v1/games?q=` and returns the exact case-insensitive name or alias match first, otherwise the first hit, otherwise null.
  - `insights(slug): Promise<Insights | null>`.
  - `recentArticles(since: Date): Promise<FeedArticle[]>`.
  - `createArticle(payload, idempotencyKey: string): Promise<{ id: string; url: string; slug: string }>`.
  - `patchArticle(id, patch, idempotencyKey): Promise<void>`.
- `Authorization: Bearer <key>` is sent on every call.
- 429 and 5xx are retried 3 times with backoff, honoring `Retry-After`. Other 4xx errors throw `TralkedError { status, code, issues }`, without retrying.
- On a 422 whose `issues` point at `/games/<n>`, the client removes that game and retries once. On a 409 `slug_conflict`, it retries once with `slug = slugify(title) + "-" + storyId`.
- The idempotency key is `robo-<mode>-story-<id>` for creation and `robo-update-<articleId>-<n>` for updates.

- [ ] **Step 1: Failing tests,** with a mocked `fetch`:
  - The retry after 429 honors `Retry-After` (with a fake timer).
  - A 422 on `/games/1` is retried without that game.
  - A 409 is retried with a suffixed slug.
  - A 401 throws immediately.
  - `findGame` prefers an exact alias match.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass.
- [ ] **Step 4:** Commit `feat(robo): Tralked API client with retries and repairs`.

### Task 12: `coleta` and `publica` commands (live schedule)

**Files:** `src/commands/coleta.ts`, `src/commands/publica.ts`, `src/pipeline.ts`, `test/pipeline.test.ts`

**Interfaces:**
- Produces `runColeta(deps: { db; ai; tralked; sources; config; now: () => Date; fetchFn }): Promise<ColetaReport>`. In order:
  1. Exit early when `DATA_DIR/PAUSADO` exists (it only logs).
  2. Collect live items, insert the new ones, and update `source_health`.
  3. Triage the new items.
  4. Fetch and extract the full text for kept items only.
  5. Cluster against open stories.
  6. Recompute each touched story's score, `bomb` and `rumor`.
  7. Drop stories already covered on the site: `recentArticles(now - 3d)`, where a match means the same game slug **and** a title match decided by `clusterItems`, with the feed articles passed as open stories.
  8. Queue publishable stories (`status = queued`).
  9. Expire stale ones.
  10. When a queued story is a bomb and `publishedCountOn(today) < MAX_PER_DAY`, call `publishStory` immediately, even outside the slot window.
  11. When a story already **published today** gets new items with `importance >= 50`, regenerate it with the previous article as context and PATCH it with `updatedAt`, without counting toward the cap.
  12. When the story was published on an earlier day and the new items have `importance >= 70`, create a follow-up story with `parent_article_id`, which is queued normally.
- Produces `runPublica(deps & { sleep: (ms) => Promise<void>; rand: () => number }): Promise<{ published: string | null; reason: string }>`. In order:
  1. If paused, outside `inSlotWindow`, or `publishedCountOn(today) >= MAX_PER_DAY`, return a reason and do nothing.
  2. Sleep `rand() * 12 min`.
  3. Pick the highest-score queued live story that is not expired.
  4. Call `publishStory`.
  5. On a failed check, mark the story `dropped`, raise an alert, and try the next story **once**.
- Produces `publishStory(story, deps): Promise<string | null>`. It resolves games through `findGame` and `insights`, runs `writeAndCheck`, `assemble` and `createArticle`, then saves the article with status `published`. `BudgetExceededError` stops the run and raises an alert.

- [ ] **Step 1: Failing tests** (`pipeline.test.ts`, everything injected and in-memory, using a temp dir for the DB):
  - The slot window at 05:59, 06:00, 23:59 and 00:03 local.
  - The 16th publish of the day is refused.
  - A bomb at 03:00 local is published once, and is refused when 15 have already been published.
  - Two `coleta` runs with overlapping items publish 1 article, not 2.
  - A story covered by an editorial article in the feed is dropped.
  - A same-day update calls `patchArticle` with the "Atualizado às" note and does not change the day count.
  - A follow-up on a later day becomes a new queued story.
  - `PAUSADO` stops both commands.
  - A budget error during writing stops publishing, keeps the story `queued`, and creates an alert.
  - An expired story is never picked.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass. The `src/commands/*.ts` entry files only wire the real deps (`loadConfig`, `openDb`, `new Anthropic()`, `createTralked`, `fetch`, `setTimeout` sleep, `Math.random`) and print the report.
- [ ] **Step 4:** Commit `feat(robo): live collection and hourly publishing commands`.

### Task 13: `retroativo` command (90 days, ~750 articles, Batches)

**Files:** `src/commands/retroativo.ts`, `src/backfill.ts`, `test/backfill.test.ts`

**Interfaces:**
- Produces `dayQuotas(storyCountsByDay: Map<string, number>, total = 750): Map<string, number>`. Quotas are proportional to each day's publishable story count, at least 1 for days that have stories, capped at `MAX_PER_DAY`, with a sum of at most `total` (the largest remainder gets rounding priority).
- Produces `runRetroativo(deps, phase?: "descobrir" | "triar" | "agrupar" | "escrever" | "publicar")`. Each phase is resumable and reads and writes only DB state. With no argument it runs every phase until done.
  - **descobrir**: for each source, read `backfill.sitemap`, falling back to the RSS feed, recursing into child sitemaps. Insert the items with `published_at` in the last `BACKFILL_DAYS` days.
  - **triar**: Haiku in batches of 50 titles. It uses the same `triageItems` with bucket `backfill`; the live Messages API at Haiku prices is fine here.
  - **agrupar**: cluster **per local day** of `published_at`, in order, with stories from the previous day kept open. Stories get `mode = "backfill"` and `story_date`.
  - **escrever**:
    1. Rank and apply `dayQuotas`, so that only the top N stories per day are selected.
    2. Fetch the full texts for the selected stories.
    3. Submit **one Message Batch** of writer requests using `ai.batchRequest` (`custom_id = "story-<id>"`, no fallbacks) and store the batch id in the DB.
    4. Poll every 60 s.
    5. Record usage at batch prices.
    6. Run `checkDraft` live (Haiku), with one rewrite through the live writer when it fails (bucket `backfill`).
    7. Save the payloads as `ready`.
  - **publicar**: go through `ready` articles in ascending `story_date`. Set `publishedAt = randomTimeOn(story_date)` as ISO with offset, call `createArticle` with idempotency `robo-backfill-story-<id>`, and pace at 1 request every 2 s.
  - The backfill never publishes a story that the live queue already published, and vice versa: a story is unique per `story_id`, and stories are unique by `key`.

- [ ] **Step 1: Failing tests:**
  - `dayQuotas` with 90 days of varied counts sums to at most 750, gives ≤ 15 per day and ≥ 1 per non-empty day, and is deterministic.
  - Running `publicar` twice after a crash halfway leaves no duplicates (a mocked `createArticle` counts the calls per idempotency key).
  - `publishedAt` of every created article falls between 06:00 and 23:59 local on its `story_date`.
  - A budget error in `escrever` stops before submitting the batch.
  - The batch results map back to stories by `custom_id`, never by order.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass.
- [ ] **Step 4:** Commit `feat(robo): resumable 3-month backfill with Batches and backdated publishing`.

### Task 14: Operations: alerts, daily summary, unpublish, Task Scheduler, README

**Files:** `src/alerts.ts`, `src/commands/resumo.ts`, `src/commands/despublicar.ts`, `scripts/instalar-tarefas.ps1`, `README.md`, `test/alerts.test.ts`

**Interfaces:**
- Produces `alert(db, kind: "checagem" | "orcamento" | "pausado" | "fonte" | "api" | "recusa", message: string): void`. It inserts a row and appends a line to `data/logs/YYYY-MM-DD.log`.
- Produces `sendPendingAlerts(db, config, fetchFn)`. When `RESEND_API_KEY` and `ALERT_EMAIL` are set, it POSTs `https://api.resend.com/emails` from `no-reply@tralked.com` with all unsent alerts in one e-mail, then marks them `emailed`. It is called at the end of every command.
- Produces `pnpm resumo [dia]`, which prints and e-mails the counts for a local day: collected, dropped, queued, published, updated, check failures, spend by bucket, and broken sources.
- Produces `pnpm despublicar --de 2026-08-01 --ate 2026-08-31 [--fonte ign] [--confirmar]`. Without `--confirmar` it only lists. With it, it PATCHes `{status: "archived"}` for each matching published article and marks them `archived` locally.
- Source health: `coleta` raises a `fonte` alert when a source has had no success for more than 24 h, at most once a day per source.
- Produces `instalar-tarefas.ps1`, which uses `Register-ScheduledTask` to create:
  - `Tralked Robo - Coleta`: every 30 min, indefinitely. Runs `pnpm coleta` in `ROBO NOTICIAS`.
  - `Tralked Robo - Publica`: daily triggers at 06:00, 07:00 … 23:00. Runs `pnpm publica`.
  - `Tralked Robo - Resumo`: daily at 00:10, for the previous day.
  - All three are set to "run whether user is logged on or not" when possible, otherwise run while logged on. The script states which of the two applied.
  - It is idempotent, replacing tasks that already exist.
  - A `-Remover` flag removes the tasks.
- README: setup (`.env`, `pnpm i`, key creation via `app` `pnpm api:key`), the commands, `PAUSADO`, costs, how to edit `fontes.json`, and the verified-source table.

- [ ] **Step 1: Failing tests:**
  - Alerts are e-mailed once, in a single request, and not re-sent.
  - Without `RESEND_API_KEY` no fetch happens.
  - `despublicar` without `--confirmar` makes no PATCH.
  - The source alert fires once per day.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement until they pass. Write the PowerShell script and the README.
- [ ] **Step 4:** Commit `feat(robo): alerts, daily summary, bulk unpublish and Task Scheduler setup`.

### Task 15: Go live (controller, with Lucas's key)

These steps touch production. The controller runs them, in this order, stopping at the first failure.

- [ ] **Step 1:** Merge Part A and deploy the site the way production runs today: rebuild and restart `next start :3100` with `app/.env.production.local` (see memory "Tralked hosting via local tunnel"). Smoke test:
  - `curl https://tralked.com/api/v1/articles` without a key returns 401.
  - The `/noticias` tabs show Mercado, Entretenimento and Tecnologia.
- [ ] **Step 2:** Create the production key: `DATABASE_URL=<prod> pnpm api:key "Robô de Notícias" articles:write publish`. Put it in `ROBO NOTICIAS/.env` as `TRALKED_API_KEY`. Lucas puts `ANTHROPIC_API_KEY` in the same file. The key is never printed in chat.
- [ ] **Step 3: Live dry run.** Run `pnpm coleta`. Check the report: sources OK or failing, items, queued stories, spend in cents.
- [ ] **Step 4: First live article.** Run `pnpm publica`, during slot hours (skip the jitter with `--agora`). Open the article URL and check the byline "Equipe Tralked", the sections, the sources, the game links and the absence of the robot badge. If anything is off, fix it and archive the article with `despublicar`.
- [ ] **Step 5: Backfill.** Run `pnpm retroativo` in the background, then `pnpm resumo`. Check:
  - About 750 published articles spread over 90 days.
  - Spend at or under about US$ 50 (the cap is US$ 70).
  - No duplicates: `SELECT key, count(*) FROM stories GROUP BY key HAVING count(*) > 1` returns nothing.
- [ ] **Step 6:** Run `scripts/instalar-tarefas.ps1` and confirm the 3 tasks in `Get-ScheduledTask "Tralked Robo*"`.
- [ ] **Step 7:** Commit any config/README adjustments, then tell Lucas: articles published, spend, broken sources, and how to pause.
