# Robô de Notícias

Standalone Node/TypeScript project (pnpm, Node >= 24, built-in `node:sqlite`). It collects game news, writes articles in pt-BR with Claude and publishes them on tralked.com. It writes to the site only through `/api/v1/*`, never to its database.

## Setup

1. Install: `pnpm install` (in this folder, `ROBO NOTICIAS/`).
2. Create the site API key. In `app/`, with `DATABASE_URL` pointing at the site database:

   ```
   pnpm api:key "Robo de Noticias" articles:write publish
   ```

   The secret is printed once and cannot be recovered; the database keeps only its hash.
3. Copy `.env.example` to `.env` (gitignored) and fill it in:

   | Key | Required | Meaning |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | Anthropic API key. |
   | `TRALKED_API_URL` | no | Site base URL. Default `https://tralked.com`. |
   | `TRALKED_API_KEY` | yes | The secret from `pnpm api:key`. |
   | `RESEND_API_KEY` | no | Resend API key, for alert and summary e-mails. |
   | `ALERT_EMAIL` | no | Where alerts and the daily summary are sent. |

   The other keys in `.env.example` (models, budgets, `MAX_PER_DAY`, slot hours, backfill size, `DATA_DIR`) have working defaults.
4. Check: `pnpm test && pnpm typecheck`.

State lives in `data/` (gitignored): `robo.db` (SQLite), `logs/YYYY-MM-DD.log`, the `PAUSADO` file and the publish lock. Secrets live in `.env` (gitignored).

## Commands

All commands run from this folder with `pnpm <command>`.

| Command | What it does |
|---|---|
| `pnpm coleta` | Collects every active source, triages, clusters, queues stories, publishes "bombs" right away and updates same-day articles. Runs every 30 min, 24 h a day. |
| `pnpm publica [--agora] [--fora-do-horario] [--ignorar-limite]` | Publishes the best queued story, one per hour between 06:00 and 23:00 (America/Sao_Paulo), at most `MAX_PER_DAY` (15) a day. Waits 0 to 12 min first; `--agora` skips the wait. News of the day only: a story older than `NEWS_MAX_AGE_HOURS` (12 h, counted from its first item) expires unpublished, so no backdated news goes out; Pautas Tralked (games, guides) are not affected. See "Manual publication" below for the flags. |
| `pnpm retroativo` | Backfill: writes the older articles of the last `BACKFILL_DAYS` days with backdated times, under its own budget. |
| `pnpm resumo [dia]` | Prints and e-mails the counts for a local day: collected, dropped, queued, published, updated, check failures, spend by bucket and broken sources. `dia` is `AAAA-MM-DD` or `ontem`; the default is today. |
| `pnpm despublicar --de AAAA-MM-DD --ate AAAA-MM-DD [--fonte id] [--confirmar]` | Bulk unpublish by publication day (local), optionally only stories that used source `id`. Without `--confirmar` it only lists. With it, it PATCHes `{status: "archived"}` on the site for each match and marks it `archived` locally. |

Every command ends by e-mailing the alerts not yet sent (see below).

### Manual publication

| Flag | Effect |
|---|---|
| `--agora` | Skips the 0–2 min wait. Everything else as in a scheduled run. |
| `--fora-do-horario` | Publishes even outside `SLOT_FIRST_HOUR`–`SLOT_LAST_HOUR` (06h–23h). Implies `--agora`. `MAX_PER_DAY`, the 21-minute gap (`PUBLISH_GAP_MINUTES`) and the daily budget still apply. |
| `--ignorar-limite` | Also skips `MAX_PER_DAY` and the 21-minute gap (`PUBLISH_GAP_MINUTES`). It does not skip the window (combine it with `--fora-do-horario` at night). |

```
pnpm publica --fora-do-horario                    # one story now, at 02:00 for example, within the daily cap
pnpm publica --fora-do-horario --ignorar-limite   # one more even with 15 already out today
```

No flag skips the daily budget (`DAILY_BUDGET_USD`). To spend more on one manual run, raise it for that run only: `$env:DAILY_BUDGET_USD=8; pnpm publica --fora-do-horario` (PowerShell; the variable lasts until the window is closed). An unknown flag stops the command with the usage line, so a typo never publishes with the wrong rules. Manual articles count toward the day like scheduled ones. This replaces the old `SLOT_FIRST_HOUR=0 pnpm publica --agora` trick.

### Article media (images and videos)

The sources give the robot no pictures, so media is added by code (`assemble` + `articleMedia` in `src/pipeline.ts`), never by the model:

- **The story's own official video** (an item from a `video: true` YouTube channel, see below) is embedded right after the first paragraph, with its YouTube title as the caption. When a story has videos from several channels, the `lang: "pt"` channel wins (PlayStation Brasil over PlayStation).
- **Otherwise, catalog art.** The robot asks the site for the media of the article's first linked game (`GET /api/v1/games/{slug}/media`, read-only, served from the IGDB/SteamGridDB/Steam media the site already stores) and adds one screenshot or artwork after the first paragraph (picked by story id, so stories about the same game vary), credited `Divulgação/<publisher>`. The site's article page then avoids that same image as the cover.
- **And the game's trailer** (the first IGDB video of the game) after the body, only when the article links exactly one game.
- A failure of the media endpoint never blocks an article: it goes out without media. If the site refuses a media block (422 on an `image`/`video` block), the client retries once without those blocks.

### Video stories (official YouTube channels)

Sources with `"video": true` are official YouTube channel feeds (`https://www.youtube.com/feeds/videos.xml?channel_id=...`). For them:

1. **Collection:** only uploads whose title names a trailer, teaser, gameplay, reveal, launch, demo or showcase are kept (English, Portuguese and Japanese titles; `isTrailerVideo` in `src/collect/youtube.ts`). Livestreams, podcasts, Shorts, recaps, esports matches, accolades trailers and promos are dropped before any AI call. The watch page is never downloaded; the title and the description are the material, and the video id is stored with the item.
2. **Triage and clustering** as for any item. A video about the same event as a text story joins it, and that article embeds the video.
3. **Selection:** a story whose only material is the video (a *video story*) is publishable when an official video in it has triage importance **60 or more** and it is not a rumor (`VIDEO_MIN_IMPORTANCE`).
4. **De-duplication against stories about the same game** (in `coleta`, before queueing): a video story is dropped when the site published an article about the game in the last 24 h, or a story about the game was published or is being written in the last 24 h. When an open or queued text story is about the game, the video joins that story instead. Two video stories about the same game (the same trailer on two channels) become one.
5. **Caps:** video stories count toward `MAX_PER_DAY` and the daily budget like any story, and at most **4 video stories** go out per local day (`MAX_VIDEO_STORIES_PER_DAY`); after that they stay queued until they expire. The writer gets a short "Vídeo oficial" section: it writes about what the video presents, from its title and description only.

The `coleta` report line shows how many video stories were dropped or merged as repeats.

### Task Scheduler (Windows)

`scripts/instalar-tarefas.ps1` creates three tasks in the Windows Task Scheduler (Windows PowerShell 5.1):

| Task | When | Runs |
|---|---|---|
| `Tralked Robo - Coleta` | every 30 min at :20 and :50, indefinitely | `pnpm coleta` |
| `Tralked Robo - Publica` | daily 06:00–23:59, every 7 min (the robot publishes once 21 min have passed since the last article, up to 15 a day) | `pnpm publica` |
| `Tralked Robo - Resumo` | daily at 00:10 | `pnpm resumo ontem` |

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefas.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefas.ps1 -Remover
```

- Each task runs `cmd /c pnpm ...` in the `ROBO NOTICIAS` folder, so `PATH` resolves `pnpm`. Each task appends to its own log: `data/logs/agendador-coleta.log`, `agendador-publica.log` and `agendador-resumo.log`. They used to share `agendador.log`, and a coleta that started in the same minute as a publica failed before running, because `cmd` cannot open for writing a file another `cmd` is already writing. The old `agendador.log` is no longer written and can be deleted.
- Coleta runs at :20 and :50, away from the publica runs at :00 (which wait up to 12 min and then write), so the two rarely run at the same time. When they do, they share the SQLite database safely (WAL, 5 s busy timeout) and the publish lock decides who publishes.
- After changing this script (as on 2026-11-02: separate logs, coleta at :20/:50), run it again so the tasks are replaced.
- It tries "run whether the user is logged on or not" (S4U, no password stored) and falls back to "only while logged on". The script prints which one applied.
- It is idempotent: running it again replaces the tasks. `-Remover` deletes them.
- The trigger times use this PC's clock; the robot itself decides the publishing grid in America/Sao_Paulo.

## PAUSADO (emergency stop)

Create an empty file `data/PAUSADO` and the robot stops: `coleta` collects nothing and `publica` publishes nothing, at the next run. Delete the file to resume.

```
New-Item data\PAUSADO -ItemType File      # pause (PowerShell)
Remove-Item data\PAUSADO                  # resume
```

A paused run raises a `pausado` alert, at most once a day.

## Alerts

Every alert is stored in `robo.db`, appended to `data/logs/YYYY-MM-DD.log` and e-mailed. Kinds:

| Kind | When |
|---|---|
| `checagem` | The fact checker rejected a draft twice. |
| `orcamento` | A daily or backfill budget cap was reached (once a day). |
| `pausado` | The `PAUSADO` file stopped a run (once a day). |
| `fonte` | A source has had no success for more than 24 h (once a day per source). |
| `api` | A call to the site API failed. |
| `recusa` | The model refused to write a story. |

E-mails need both `RESEND_API_KEY` and `ALERT_EMAIL`. They go from `no-reply@tralked.com` (the `tralked.com` domain must be verified in Resend), as plain text in pt-BR, with all pending alerts in one message. If Resend fails the alerts stay pending and go out after the next command. Without those keys alerts are only logged.

## Costs

Prices in USD per 1M tokens (input / output): Opus 5.5 `4 / 20` (writer), Sonnet 5.5 `2 / 10`, Haiku 5.5 `0.10 / 0.50` (triage, clustering, checker). Cache reads cost 0.1x, cache writes 1.25x and batch calls 0.5x.

Spend is recorded per call in two separate buckets with hard caps:

- `live`: `DAILY_BUDGET_USD`, default US$ 5 a day. When reached, the robot stops spending until the next local day and raises an `orcamento` alert.
- `backfill`: `BACKFILL_BUDGET_USD`, default US$ 70 in total.

`pnpm resumo` shows the spend of each bucket for the day.

## Editing the sources (`config/fontes.json`)

A JSON array with one object per source; the file is validated on every start, so a typo fails fast with the offending field.

| Field | Meaning |
|---|---|
| `id` | Unique short id (used by `despublicar --fonte`). |
| `name` | Display name. |
| `kind` | `rss` (RSS 2.0 or Atom) or `listing` (an HTML page of links). |
| `url` | Feed or page URL. |
| `tier` | `oficial`, `portal` or `outro`: how much the ranking trusts it. |
| `category` | Default category: `GAMES`, `MERCADO`, `ENTRETENIMENTO` or `TECNOLOGIA`. |
| `gamingFilter` | `true` for general feeds: only game-related items are kept. |
| `active` | `false` keeps the entry but skips it. |
| `listingSelector` | `listing` only: CSS selector of the item anchors. |
| `linkResolve` | `"google-news"` for Google News search feeds (requires a `news.google.com` URL). |
| `backfill` | Optional `{ "kind": "sitemap", "url": ... }` used by `pnpm retroativo`. |
| `video` | `true` for an official YouTube channel feed (`https://www.youtube.com/feeds/videos.xml?channel_id=UC...`, required by the schema): trailers and gameplay only, embedded in the article (see "Video stories"). |
| `lang` | Optional `pt`, `en` or `ja`: language of the source's titles. A story with videos from several channels embeds the `pt` one. |

To add a source: append an object, run `pnpm test` (it validates the file), then verify the feed by hand. Follow the bot-protection rule below: never work around a block. To retire one, set `"active": false` instead of deleting it. A source with no success for more than 24 h raises a `fonte` alert.

## Sources (`config/fontes.json`)

Verified on 2026-10-31 with real HTTP fetches using `User-Agent: TralkedBot/1.0 (+https://tralked.com)`.
51 sources: 49 active, 2 inactive (Flow Games and PXN Games added on 2026-11-02). 12 have a dated `backfill` sitemap. On 2026-11-02 the 16 official YouTube channels below were added (`video: true`), and `rockstar-youtube` and `bandai-namco` became `video: true` too.

Bot-protection rule: when a site answers 403, shows a Cloudflare/Akamai challenge, or serves a JS-only shell to our honest User-Agent, we do not work around it (no browser-imitating headers). We only use feeds published for consumption: the site's own RSS/sitemap, YouTube channel feeds, and Google News RSS search.

Notes for the collector:
- `kind: "rss"` covers RSS 2.0 and Atom (The Verge feeds are Atom).
- Send `Accept: text/html,application/xml;q=0.9,*/*;q=0.5` on listing fetches. CD PROJEKT returns 404 for some other Accept headers.
- `listingSelector` is a CSS selector for the item anchors. It also matches a few non-article links (section index pages), so de-duplicate and filter by URL pattern.
- A `backfill.url` may be a sitemap index (monthly children, e.g. PC Gamer `sitemap-2026-10.xml`) or a yearly/urlset file. The backfill code must follow indexes and keep only entries whose `lastmod` is inside the window.
- Entries with `gamingFilter: true` are general feeds; keep only items related to games.
- `cd-projekt` points at the year page `/en/media/news/2026/` (the section root intermittently returns 404). The year is hard-coded in `config/fontes.json`; `collectLive` substitutes the current UTC year into any `/20xx/` path segment of a listing URL and falls back to the previous year when the new page is missing (early January). No manual bump is needed.
- **Google News sources** (`linkResolve: "google-news"`, 4 sources: digitalfoundry, rockstar-newswire, sony-group, nintendo-ir): the feed is `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en`. Item `<link>` values are Google redirect URLs (`https://news.google.com/rss/articles/...`), not the publisher URL. The collector (`src/collect/index.ts`) resolves the real URL with plain redirected requests (honest UA, no challenge solving) and, for legacy ids, by decoding the id. As of 2026-10-31 Google answers a JS interstitial, so in practice **no item resolves**: the item is kept with the Google link as `url`, its title, `publisher` (the `<source>`) and `textUnavailable: true`. Later stages must not download or extract text for `textUnavailable` items; the title and publisher are all there is. Resolution stops after 3 failed first attempts (no request flood) and covers at most the 40 newest items per feed. Unresolved items whose title matches an item from another source are dropped. The item `<source>` element names the publisher. Queries use `site:` plus `when:Nd`; results are ordered by relevance, so sort by `pubDate`. They also include non-article pages of the site (index and author pages), which triage will drop. The schema requires `linkResolve: "google-news"` sources to use a `news.google.com` URL.
- **YouTube channel feeds** (`https://www.youtube.com/feeds/videos.xml?channel_id=...`): Atom, titles and descriptions are the usable material. The endpoint is flaky: the same channel id answers 200 on one call and 404/500 on the next. The collector must treat a failure as a normal source error (`source_health`) and retry on the next 30-minute run; never fail the run.

### Active

| Source | URL | Type | Verified | Notes |
|---|---|---|---|---|
| IGN | `https://feeds.feedburner.com/ign/games-all` | rss | yes | 20 items, newest today. Backfill: `sitemap-articles-2026.xml` (10446 urls). |
| GameSpot | `https://www.gamespot.com/feeds/news/` | rss | yes | 30 items. Site and sitemaps sit behind a Cloudflare challenge, feed works. No backfill. |
| Eurogamer | `https://www.eurogamer.net/feed` | rss | yes | 100 items. Backfill: `sitemap-2026.xml` (5398 urls). |
| PC Gamer | `https://www.pcgamer.com/rss/` | rss | yes | 50 items. Backfill: sitemap index with monthly children. |
| Polygon | `https://www.polygon.com/rss/index.xml` | rss | yes | Redirects to `/feed/`. Backfill: sitemap index with monthly `-articles` children. |
| Video Games Chronicle | `https://www.videogameschronicle.com/feed/` | rss | yes | 10 items. Its post sitemap is stale (2019-2024), so no backfill. |
| Rock Paper Shotgun | `https://www.rockpapershotgun.com/feed` | rss | yes | 100 items. Backfill: `sitemap-2026.xml` (3724 urls). |
| GamesIndustry.biz | `https://www.gamesindustry.biz/feed` | rss | yes | 100 items. Category MERCADO. Backfill: `sitemap-2026.xml` (1467 urls). |
| The Verge (games) | `https://www.theverge.com/rss/games/index.xml` | rss (Atom) | yes | 10 items. |
| Kotaku | `https://kotaku.com/rss` | rss | yes | Redirects to `/feed`. Backfill: sitemap index with monthly `post-sitemap-YYYY-MM.xml`. |
| Digital Foundry (via Google News) | `https://news.google.com/rss/search?q=site:digitalfoundry.net when:30d` | rss, `linkResolve` | yes | Replaces the stale Eurogamer DF tag feed and the Cloudflare-blocked `digitalfoundry.net/feed`. 73 items, newest 2026-10-31. Tried and rejected: the YouTube feed for channel `UC9PBzalIcEQCsiIkq36PyUA` (verified from the channel page) answered 404/500 on all 12 attempts; Google News `site:eurogamer.net/digitalfoundry` returned 0 items; the plain query `"Digital Foundry"` returns third-party mentions. |
| Rockstar Newswire (via Google News) | `https://news.google.com/rss/search?q=site:rockstargames.com/newswire when:90d` | rss, `linkResolve` | yes | The newswire page is a JS shell and `/newswire/rss` and friends return 500, so this is the route. 45 items, newest 2026-10-29 (GTA VI, GTA Online). Newswire pages are JS-rendered, so article text extraction may fail; the title is usable and `rockstar-youtube` supplies descriptions. |
| Rockstar Games (YouTube channel) | `https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A` | rss (Atom) | yes, flaky | Channel id read from `youtube.com/@RockstarGames`. 15 entries, newest 2026-10-15. Answered 404 on two early attempts, 200 on the next, then 404 again in the final verification run (see the YouTube note). |
| Bandai Namco Entertainment (YouTube channel) | `https://www.youtube.com/feeds/videos.xml?channel_id=UCqly9F4Fr_jf2Y1Cy5hacRg` | rss (Atom) | yes, flaky | Replaces the JS-rendered press page. 15 entries, newest 2026-10-29. Channel id read from `youtube.com/@BandaiNamcoEntertainment`. |
| Embracer Group (YouTube channel) | `https://www.youtube.com/feeds/videos.xml?channel_id=UCFq1IPfyTFFeyKOnsdI40ew` | rss (Atom) | yes, flaky | Replaces the JS-rendered press page (feeds 500). 15 entries, newest 2026-05-20, so it is low volume. Google News `site:mfn.se Embracer` (Embracer's regulated-news distributor) returns only weekly buyback notices, so it was not added. |
| Sony Group news (via Google News) | `https://news.google.com/rss/search?q=site:sony.com/en/SonyInfo/News when:60d` | rss, `linkResolve` | yes | `sony.com` answers 403 to our User-Agent, so we do not fetch the site; Google News indexes the official newsroom. 4 items, newest 2026-10-29. `gamingFilter: true` (Sony Group is not only games). Article fetches will probably still be 403 and fall back to the title and snippet. |
| Nintendo investor relations (via Google News) | `https://news.google.com/rss/search?q=site:nintendo.co.jp/ir when:90d` | rss, `linkResolve` | yes | The IR news list is JS-rendered. Google News returns the IR documents (financial results, sales units). 4 items, newest 2026-09-17; low volume, results season only. |
| PlayStation Blog | `https://blog.playstation.com/feed/` | rss | yes | Backfill: `wp-sitemap.xml` index. |
| Xbox Wire | `https://news.xbox.com/en-us/feed/` | rss | yes | Backfill: `sitemap_index.xml` (dated `lastmod`). |
| Nintendo (news and events) | `https://www.nintendo.com/us/whatsnew/` | listing | yes | No RSS exists (`/us/rss/` is 404). Selector matches 31 links. |
| Steam News | `https://store.steampowered.com/feeds/news/` | rss | yes | 10 items. |
| Take-Two Interactive | `https://www.take2games.com/ir/press-releases` | listing | yes | The old `ir.take2games.com` redirects here; its RSS URL is 404. Selector matches 100 links. |
| Sony Interactive Entertainment | `https://sonyinteractive.com/en/news/press-releases/` | listing | yes | Selector matches 10 links. |
| Microsoft Source | `https://news.microsoft.com/source/feed/` | rss | yes | General Microsoft feed (the gaming topic feed is 404), so `gamingFilter: true`. Xbox Wire covers Microsoft Gaming proper. |
| Ubisoft News | `https://news.ubisoft.com/en-us/` | listing | yes | `ubisoft.com/.../newsroom` is JS only; `news.ubisoft.com` serves HTML. 8 links. |
| Electronic Arts News | `https://www.ea.com/news` | listing | yes | 21 links. `ir.ea.com` redirects to the main site and has no RSS. |
| Capcom (IR news) | `https://www.capcom.co.jp/ir/english/news/` | listing | yes | 33 links. Slow (about 10 s). |
| Square Enix Holdings | `https://www.hd.square-enix.com/eng/news/` | listing | yes | `a.newsBoxTxt`, 21 links (some are PDFs or external press sites). |
| CD PROJEKT (news) | `https://www.cdprojekt.com/en/media/news/2026/` | listing | yes | 11 links. See the Accept note above. |
| Alinea Analytics (blog) | `https://alineaanalytics.com/blog/` | listing | yes | No RSS. 14 links; posts are infrequent. |
| Circana (blog) | `https://www.circana.com/blog-feed.xml` | rss | yes | 20 items, newest 2026-10-29. The `/news?type=press+releases` page loads (200) but was not parsed, so the blog feed is the verified entry. `gamingFilter: true` because it covers all retail verticals. |
| IGN Brasil | `https://br.ign.com/feed.xml` | rss | yes | 40 items. |
| Canaltech | `https://canaltech.com.br/rss/` | rss | yes | 50 items. The `/rss/games/` feed is stale (newest 2026-07-12), so the general feed is used with `gamingFilter`. Backfill: `smap/sitemap.xml` (4993 urls, since 2026-07-10). |
| Adrenaline | `https://www.adrenaline.com.br/feed/` | rss | yes | 40 items. Child post sitemaps return 403, so no backfill. |
| Tecmundo | `https://rss.tecmundo.com.br/feed` | rss | yes | 50 items. `/feed/games` returns the same general feed. |
| TechTudo | `https://www.techtudo.com.br/rss/techtudo/` | rss | yes | 100 items. |
| Variety | `https://variety.com/feed/` | rss | yes | 10 items. |
| Deadline | `https://deadline.com/feed/` | rss | yes | 12 items. Backfill: sitemap index with monthly `post-sitemap2026MM.xml`. |
| The Verge (all) | `https://www.theverge.com/rss/index.xml` | rss (Atom) | yes | Backfill: `/sitemaps` index, monthly `entries/2026/10`. |
| Ars Technica (gaming) | `https://feeds.arstechnica.com/arstechnica/gaming` | rss | yes | 20 items, newest 2026-10-23. |
| Ars Technica (technology) | `https://feeds.arstechnica.com/arstechnica/technology-lab` | rss | yes | 20 items. |
| Tom's Hardware | `https://www.tomshardware.com/feeds/all` | rss | yes | Redirects to `/feeds.xml`. 50 items. |

### Official YouTube channels (`video: true`)

Channel ids read from the channel page (`youtube.com/@<handle>`, canonical link) and checked on 2026-11-02 by fetching each feed with our User-Agent (all answered 200 with 15 entries, newest in the last weeks unless noted). Channels whose id could not be confirmed as the publisher's own were left out: `@EA` (not EA), `@Activision` (empty feed), `@NintendoBrasil` and `@playstationbrasil` (fan channels, last uploads 2018 and 2009), `@XboxBR` (could not confirm it is official), `@SEGA` and `@Capcom` (Japanese channels; `capcom-youtube` uses Capcom USA).

| id | Channel | Channel id | Notes |
|---|---|---|---|
| `playstation-youtube` | PlayStation | `UC-2Y8dQb0S6DtpxNgAKoJKA` | Many trailers a day (PS5 indies included); triage and the 60 bar filter them. |
| `playstation-br-youtube` | PlayStation Brasil | `UC6i4mzH3OPrZV0p64zoz-Ww` | `lang: "pt"`: "Trailer de Lançamento", "Trailer de Jogabilidade". Preferred for embedding. |
| `xbox-youtube` | Xbox | `UCjBp_7RuDBUYbd1LegWEJ8g` | |
| `nintendo-youtube` | Nintendo of America | `UCGIY_O-8vW4rfX98KlMkvRg` | |
| `ubisoft-youtube` | Ubisoft | `UC0KU8F9jJqSLS11LRXvFWmg` | |
| `ea-youtube` | Electronic Arts | `UCIHBybdoneVVpaQK7xMz1ww` | Low volume (newest 2026-03); EA's games post on their own channels. |
| `bethesda-youtube` | Bethesda Softworks | `UCvZHe-SP3xC7DdOk4Ri8QBw` | |
| `capcom-youtube` | Capcom USA | `UCW7h-1mymnJ96akzjrmiIgA` | |
| `square-enix-youtube` | Square Enix (NA) | `UCA5SLTAVA6unn1M-6lbo1NA` | |
| `blizzard-youtube` | Blizzard Entertainment | `UC3GriadTkHBnfgd2UFETGOA` | Newest 2026-09. |
| `cdpr-youtube` | CD PROJEKT RED | `UCuCtanBJXOPAEIAUXf9944g` | Mostly podcasts lately; the title filter drops them. |
| `wb-games-youtube` | Warner Bros. Games | `UCHqAOjD1bj-PvtPcK8qDFMQ` | |
| `call-of-duty-youtube` | Call of Duty | `UC9YydG57epLqxA9cTzZXSeQ` | Activision's main video channel. |
| `konami-youtube` | Konami | `UCwkUBN7foWU9GcY5cFmso-Q` | |
| `riot-youtube` | Riot Games | `UCJEGvSZnQ1pkVfHO8s5G8hA` | |
| `2k-youtube` | 2K | `UC0SBn2zaskenN1hl_PCtQWw` | Newest 2026-06. |
| `rockstar-youtube` | Rockstar Games | `UC6VcWc1rAoWdBCM0JxrRQ3A` | Existing source, now `video: true`. |
| `bandai-namco` | Bandai Namco Entertainment | `UCqly9F4Fr_jf2Y1Cy5hacRg` | Existing source, now `video: true`, `lang: "ja"` (titles in Japanese, "PV" = trailer). |

The YouTube feed endpoint is flaky (see above): a failed fetch is a normal source error and the channel is tried again in 30 minutes.

### Inactive (`active: false`)

| Source | URL | Type | Verified | Why |
|---|---|---|---|---|
| Epic Games Store News | `https://store.epicgames.com/en-US/news` | listing | no | The store, `epicgames.com/site/.../news` and `unrealengine.com` answer 403 (Cloudflare challenge), so they are not fetched. Routes tried: YouTube feeds for the three Epic channel ids found on `youtube.com/@EpicGamesStore` (`UC5Qk8mWBwtMyEj7iQQYRk1A`, `UCT16M1NqxN-OPc3E1rP8cmQ`, `UCrNC5OLd5jUHZb6DTtwjY9A`) answered 404 on every attempt (3 rounds); Google News `site:epicgames.com/site/en-US/news` returned 0 items and `site:store.epicgames.com` only returns product and cart pages, not news. A coverage query (`"Epic Games Store" free games`) works but is third-party reporting, not Epic's own voice, so it was not added. |
| CD PROJEKT (regulatory) | `https://www.cdprojekt.com/en/investors/regulatory-announcements/` | listing | no | 404 for every fetch (same WordPress quirk as the news root). Google News only returns third-party coverage of CD Projekt. The active `cd-projekt` news listing covers the company's own announcements. |

Moved to active in the fix round: Digital Foundry, Rockstar Newswire, Sony Group, Nintendo IR, Bandai Namco and Embracer (see the active table for routes). Original blocks: Digital Foundry tag feed stale since 2026-02-10 and `digitalfoundry.net` behind a Cloudflare challenge; Rockstar newswire JS shell with 500 on feeds; `sony.com` 403 (Akamai); Nintendo IR and Bandai Namco and Embracer press lists JS-rendered.

## Models and SDK

`@anthropic-ai/sdk` 1.3.0 is installed but not used until Task 8. `@anthropic-ai/sdk/helpers/zod` exports `zodOutputFormat`, and `client.beta.messages.parse` exists in the types.

## Robô de Guias

A second robot in this folder writes the Tralked guides (format 2, the walkthrough) **on demand only**: it processes the requests Lucas puts in the queue at `/admin/guias/pedidos` and never picks a game by itself. It shares the AI client, the spend control and the site HTTP core with the news robot, but has its own config, SQLite and lock, so one robot never stops the other.

### Setup

1. Create the site key (in `app/`, with `DATABASE_URL` pointing at the site database). Never give it `publish`: robot guides always go to the review queue.

   ```
   pnpm api:key "Robo de Guias" guides:write media:write
   ```

2. Add to `.env`:

   | Key | Required | Meaning |
   |---|---|---|
   | `TRALKED_GUIDES_API_KEY` | yes | The secret above. |
   | `ANTHROPIC_API_KEY` | yes | Same as the news robot. |
   | `GUIDE_BUDGET_USD` | no | Spend cap per request (every attempt of it), default US$ 25. |
   | `GUIDE_SOFT_DEADLINE_MIN` | no | Minutes after which a written guide is sent without (more) images and soundtrack, default 150 (the lock goes stale at 180). |
   | `GUIDE_FORCE_DISCOVERY` | no | `1` searches the web for sources again even when a discovery of the last 7 days could be reused (default `0`). |
   | `RESEND_API_KEY` / `ALERT_EMAIL` | no | Same as the news robot: the guide robot's alerts (`guia-falha-robo`) are e-mailed at the end of each run. |
   | `MODEL_WRITER` / `MODEL_EXTRACT` / `MODEL_FAST` | no | Defaults `claude-opus-5-5` (writing), `claude-sonnet-5-5` (extraction and web search), `claude-haiku-5-5` (checker, image locating). |
   | `DATA_DIR_GUIAS` | no | Default `./data-guias` (gitignored): `robo-guias.db` (page cache, runs, spend, dossiers, extracted facts, write drafts), `guia.lock`, `logs/`, `relatorios/` (each run's report). |

### Requesting a guide

Use the admin: `/admin/guias/pedidos` → "Pedir guia" (search the catalog or type the Steam appid). "Atualizar guia existente" asks for a new version of a game that already has a guide. There is no `pnpm guia:pedido` shortcut: creating a request needs a staff session, which the robot's API key does not have.

### `pnpm guia`

Processes **one** request and exits. Without a request it prints `nada na fila`. It holds `data-guias/guia.lock` (a lock older than 3 h belongs to a crashed run and is taken over); a second run while one is going prints `outra execução está em andamento`.

**Direct mode (no request):** `pnpm guia -- --appid <n> [--atualizar]` runs the whole pipeline for a Steam appid without claiming a queue request, so it does not appear in `/admin/guias/pedidos`. Use it to put a game's guide up right away. The game must already be in the catalog with Steam achievements (the robot never creates catalog entries); otherwise it stops with a PT-BR message. It uses the synthetic request id `direto-<appid>` for the spend cap (`GUIDE_BUDGET_USD`, earlier spend under that id counts), the discovery / extraction / writing caches (shared with queue runs of the same game) and the logs. Reports that would go to the request are local log lines (`guia: [direto] relato ...`); the outcome (review / waiting_sources / failed) is saved in `runs` as usual. The guide goes out with `createGuide` in review. A game that already has a robot guide is refused unless `--atualizar` is given (then `patchGuide`, same rules as the queue); a game with an editorial guide is always refused. Same lock, soft deadline, limits and gate (R32, PSN fallback), images and soundtrack.

One request, in order: claim the next request → the game's full Steam list (`/dossie?all=1`, hidden achievements included) → find the sources (PowerPyx, the 3 best Steam guides about 100%, TrueSteamAchievements, up to 6 web searches) → read each page (robots.txt, 2 s per host, 5 s on `steamcommunity.com`; a Cloudflare/Anubis challenge page is a source not read, never worked around) → extract the facts (cached by page content: a retry only pays for pages that changed) → group copies of the same text as one source → the dossier → the **completeness gate** → write and check → item images → official soundtrack → send → report.

| Ends in | When |
|---|---|
| `review` | The guide was created (or, for a game whose guide the robot wrote, updated with `PATCH`; a published guide keeps its live version until an editor approves the pending update). |
| `waiting_sources` | The gate found gaps. Nothing is sent; the request's report lists what is missing (`missing`). The site retries it every 3 days, for up to 30 days. |
| `failed` | Reason `teto de gasto` when the request's cap was reached; the checker still rejected the guide after one rewrite (`problems` in the report; the draft is saved and the next attempt resumes from it); the game already has a guide written by the team (the robot never replaces it); or any other error, with its message. |

Whatever happens after the claim, the request ends in one of these three: it is never left in `researching` or `writing` (the final report is retried for about 2 minutes). If the request was cancelled on the site meanwhile, the robot stops and reports nothing more.

Chapters come from the **primary script** alone (complete PowerPyx and its region pages, else a complete Steam guide), in its order: region pages in the order they state ("Crimson Forest is the 2nd region"), the roadmap's "Step N" as phases, a page's own "Clean Up Visits" / "Second Visit" after the last first visit (marked for review), a revisit another page places ("Crimson Forest Cleanup #3" on the Mirage Estate page) where that page puts it. Other sources never make chapters: their items confirm the primary's items they match (once more by English name), the rest only corroborates and goes to the report as `unplaced` ("Itens só de fonte secundária, não posicionados", with source, chapter and missable / until / come back later / counts toward); a missable among them adds a warning to `divergences` but never fails the gate and never gets a place in the route. Pages of one site count as one source. A counting item of a "collect N" achievement without a number gets the next number of its type in its chapter and goes to review (its key stays by name). Items the primary script names only in its roadmap stages are matched to the route or listed apart (`stageOnly`). A misspelt English name only matches with the same numbers (digits and roman numerals), the same type and in the same chapter or region.

Discovery (PowerPyx, the Steam guide list, up to 6 paid web searches) is saved with the request and reused for 7 days by a new attempt of the same request or a request of the same game (`guia: fontes da descoberta reaproveitadas`), unless `GUIDE_FORCE_DISCOVERY=1`. Localized achievement names (for Chinese / Russian / Japanese / Korean Steam guides) come from the game's public page `steamcommunity.com/achievements/<appid>?l=<language>` (its embedded schema has every apiname, hidden ones included), with the reference profile's XML as a fallback; a list that comes back in English is reported as not read. A page that numbers its entries ("#12 – Memory Flower") is checked against what its own text lists (`completeness.ts`): the numbers present, capped by the stated total ("contains 161" with only #1..#106 on the page is 106; the rest sits on another page), and each type of its summary ("- Sha-Chi Amber Shards: 6", capped the same way) matched by name. Under 90% of the entries, or under a type's total, the page is read once more in parts of at most 15k characters with "list EVERY numbered entry"; the reading with more entries wins, but only up to 110% of the entries (more is marked `suspect`, and its items never close a "collect N"). Still short: `divergences` start with "Extração incompleta: …", and on a page of the primary script that is under 90% or under a type a "collect N" counts, it is a gap of the gate (R32: an incomplete guide does not go out). A "collect N <things>" that no source links items to counts the route's items of that type or name (`countedByType`, and `report.collectByType`; the achievement goes to review): a part of the thing ("Sha-Chi Amber Fragment", or an item whose name says shard / fragment / piece / petal) counts 1/N only when a source says N make one (any language: "每4块碎片合成1块"), never 1:1; a thing the sources say comes in a varying number of parts ("each has 2-6 petals") counts 1/most as a lower bound, for review; a type that only contains the name ("Relic Key" for "Relics") is linked for review and never counted. Only the lead clause of a how-to sets N ("collect 3 herbs" inside "Complete [Flesh Lily]: …" does not). A loose missable achievement whose milestone names no chapter or item gets a warning anchor from its texts, for review (`warnChapter`; the guide opens that chapter with "Perdível: as fontes ligam **X** a este capítulo; fique atento a partir daqui."): the milestone, whole (a region in any word order, "entering X" being the chapter before X; else a boss / NPC that a route item names or mentions, "Reward for defeating Jing Ye"), else the earliest region its how-to names, else a boss / NPC / quest it names that is a route item, else a route item whose text mentions it ("requires true ending steps"). The anchor never limits where it is done: the writer may place it later, and by default it goes to the end of the last region / boss its texts name (`doneChapter`). Sources that disagree on missable keep it missable, with the conflict. When neither gate passes, the report's `scope` is `null`.

The approved writing (before images and soundtrack) is cached in `robo-guias.db`: a new attempt or another request of the same game with the same dossier (Steam rarity, critic score and time to beat only in coarse bands, since the site refreshes them daily), scope, style prompt, models and `WRITER_CACHE_VERSION` (bump it in `src/guias/writing-cache.ts` when the writer, checker, skeleton or contract change) reuses it without the AI (`report.notes`: "escrita reaproveitada do cache"); images and soundtrack are redone on every send. If the soft deadline already passed before writing and there is no cached writing, the request ends `failed` ("tempo esgotado antes da escrita") and the caches stay. robots.txt that answers 5xx/429 or fails is tried once more after 5 s before the host is held back.

Before writing, the guide's shape is checked against the site's limits (60 chapters, 80 steps per chapter, 40 items per step, 1 MiB per request); a guide that cannot fit ends `failed` with the reason before any writing spend. Once written, the guide is always sent. Images are decided on the written guide's real size: the most useful first (missables, counted collectibles, then the rest, in route order), only while they fit; if the body still passes 1 MiB, images go from the end of the route back, then the report's long lists are cut (missable unplaced items and the missable warnings always stay), and images and the soundtrack are skipped after `GUIDE_SOFT_DEADLINE_MIN` or when the spend cap is hit; `report.notes` says what was left out.

**Drafts: no paid writing is lost.** Every write-and-check round is saved in `robo-guias.db` (table `drafts`), approved or not: the assembled payload, the checker's problems with their scope (`frame` or the write job, i.e. the first step key of a run of up to 20 steps) and kind (`checador`, `reparo`, `copia`, `vocabulario`, `cronologia`), the code's repairs and notes (`nota`: something the code placed by itself where the dossier says, e.g. a loose missable put before its point of no return; recorded, never a reason to rewrite), the internal errors and the model's texts. A new attempt with the same writing key (any request of the game) resumes from the last draft: it keeps every part the checker accepted and writes only the parts that still have problems or were never written, then checks those plus every job whose rendered steps changed (a loose achievement's text comes from the cleanup job), and a failure still gets one more rewrite. After a `WRITER_CACHE_VERSION` bump or a new style manual (another writing key, same inputs: each draft keeps the base key `writingBaseKey`, and drafts of v4, saved before it, are found by their v4 key), only the job texts the old checker accepted carry over (`carriedDraft`): the frame and every part with a problem or a pending check are written again, and each carried text is checked again by the new checker before use (`checagem-devida`), rewritten only if it rejects it. The writing cache above keeps only approved writings. `pnpm guia -- --rascunho <pedido> [--dados <dir>]` prints the last draft of a request (`direto-<appid>` in direct mode) with its problems grouped by kind and scope and counted (no AI, no network, no lock). Each run also writes its report, with the full scoped problem list, to `data-guias/relatorios/<pedido>-<tentativa>.json` (queue and direct mode; the queue mode still sends `report.problems` to the site). The direct mode prints the first 30 problems and the file's path; its attempt number is the count of earlier runs of `direto-<appid>` + 1.

**Cheap probe before paying a whole guide:** `pnpm guia -- --appid <n> --sonda [--capitulos N]` runs the pipeline up to the writing (same caches, gate, scope and limits), then writes only the frame and the first N story chapters (default 2), checks them once with the same rules (LLM checker plus the deterministic checks: repairs, copy, vocabulary, chronology), prints all their problems grouped by kind and scope, saves the draft and the report file, and stops: nothing goes to the site, no images, no soundtrack, no rewrite. It costs about US$ 0.50 to 1 and is spent under `direto-<appid>` (it counts toward the cap). The probe's draft is never an approved writing, but the next full run resumes from it: the frame and the probed chapters the checker accepted are not paid again. A probe that itself resumes from a failed full draft keeps that draft's failures outside its chapters as pending (shown by `--rascunho`, not part of the probe's verdict): the next full run still rewrites them. A job outside the probe's chapters whose rendering the probe changed (a loose achievement its rewrite stopped placing went there) is recorded as pending `checagem-devida`: the next full run checks it again and rewrites it only if the checker rejects it. Use it to see whether the checker still rejects most chapters before paying for the whole guide. With an approved writing already cached it says so and writes nothing.

**What the checker judges (Task 21).** Its answer is a list of entries `{ tipo: "defeito" | "correto", texto }`, told to list only defects; a "correto" entry (a point it found right) is never a problem but is kept with the draft's notes and the report file as kind `checador-correto`, for audit, and a defect without a description still fails the part ("O checador reprovou este trecho do guia sem apontar o problema."). The warnings the code writes (a missable of a step, always named: "Perdível: pegue **X** / a conquista oculta ||Y|| agora, antes de seguir."; the chapter-start anchor) are taken out of the text it judges and given apart in `<avisos_do_codigo>` ("escrito pelo código: não julgue"), each with its basis in the dossier (milestone `ate`, `avisar_em`, `concluir_em`, `prazo_suposto`). A writer block that only repeats a code warning is dropped. The writer is told (manual and job message) not to restate or expand them.

**Free dry run:** `pnpm guia -- --ensaio --appid <n>` (or `--pedido <id>`, optional `--dados <dir>` for another data folder, e.g. a copy). No AI, no network: it replays the request on the cached pages and cached extraction and prints the sources (with stale or missing extractions), the gate's gaps, the scope it would choose, the chapters in order with their item counts, agreed / single-source items, the site limits, the estimated size and a rough estimate of the writing cost.

The **report** goes with the request and with the guide (`Guide.report`, staff only): `sourcesRead` (`{ name, url, ok, reason? }`, failed searches included), `divergences`, `singleSource`, `coverage` (`{ steam, covered, steamOnly }`, which the page's compat seal also reads), `spendUsd` (the request's total, every attempt) and `spendByPurpose`.

Read `sourcesRead` before trusting a `waiting_sources`. If most sources say `extração falhou: …` with the same message, the robot is broken, not the sources, and waiting 3 days will not help: fix the cause, then press "Tentar agora" on the request in `/admin/guias/pedidos`. A `página de desafio` reason is normal (that site blocks robots). The first Phantom Blade Zero run (2026-11-03) hit this: every extraction failed with `Streaming is required for operations that may take longer than 10 minutes`, which the Anthropic SDK throws, before sending anything, for a non-streaming request whose `max_tokens` is above about 21,000.

Images: picked from the block of each item in the pages read (wikis and Steam guides first, PowerPyx last), uploaded as WebP with a lime ring and arrow on the spot and the TRALKED mark. A third-party image is never cropped and keeps its own watermark; the item shows `Imagem: <fonte>` and links to the page. Soundtrack: only a YouTube video or playlist from the developer's or publisher's own channel; otherwise the guide has no music.

### Task Scheduler (Windows)

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefa-guias.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefa-guias.ps1 -Remover
```

Creates `Tralked Robo - Guias`: `pnpm guia` every 30 min (at :05 and :35), `-MultipleInstances IgnoreNew`, a 3 h time limit, output appended to `data-guias/logs/agendador-guias.log`. Same structure as `instalar-tarefas.ps1` (S4U with fallback to "only while logged on", idempotent, `-Remover`).
