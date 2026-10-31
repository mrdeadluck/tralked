# Robô de Notícias

Standalone Node/TypeScript project (pnpm, Node >= 24, built-in `node:sqlite`). It writes to the site only through `/api/v1/*`.

```
pnpm install
cp .env.example .env     # fill ANTHROPIC_API_KEY and TRALKED_API_KEY
pnpm test && pnpm typecheck
```

State lives in `data/` (gitignored). Secrets live in `.env` (gitignored).

## Sources (`config/fontes.json`)

Verified on 2026-10-31 with real HTTP fetches using `User-Agent: TralkedBot/1.0 (+https://tralked.com)`.
44 sources: 42 active, 2 inactive. 12 have a dated `backfill` sitemap.

Bot-protection rule: when a site answers 403, shows a Cloudflare/Akamai challenge, or serves a JS-only shell to our honest User-Agent, we do not work around it (no browser-imitating headers). We only use feeds published for consumption: the site's own RSS/sitemap, YouTube channel feeds, and Google News RSS search.

Notes for the collector:
- `kind: "rss"` covers RSS 2.0 and Atom (The Verge feeds are Atom).
- Send `Accept: text/html,application/xml;q=0.9,*/*;q=0.5` on listing fetches. CD PROJEKT returns 404 for some other Accept headers.
- `listingSelector` is a CSS selector for the item anchors. It also matches a few non-article links (section index pages), so de-duplicate and filter by URL pattern.
- A `backfill.url` may be a sitemap index (monthly children, e.g. PC Gamer `sitemap-2026-10.xml`) or a yearly/urlset file. The backfill code must follow indexes and keep only entries whose `lastmod` is inside the window.
- Entries with `gamingFilter: true` are general feeds; keep only items related to games.
- `cd-projekt` points at the year page `/en/media/news/2026/` (the section root intermittently returns 404). TODO: the year is hard-coded in `config/fontes.json`; bump it every January (or have the collector substitute the current year) before 2027-01-01, otherwise this source stops producing new items.
- **Google News sources** (`linkResolve: "google-news"`, 4 sources: digitalfoundry, rockstar-newswire, sony-group, nintendo-ir): the feed is `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en`. Item `<link>` values are Google redirect URLs (`https://news.google.com/rss/articles/...`), not the publisher URL. The Task 7 collector must resolve the real URL before storing the item and before `normalizeUrl`/de-duplication, and skip the item when it cannot resolve it. The item `<source>` element names the publisher. Queries use `site:` plus `when:Nd`; results are ordered by relevance, so sort by `pubDate`. They also include non-article pages of the site (index and author pages), which triage will drop. The schema requires `linkResolve: "google-news"` sources to use a `news.google.com` URL.
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

### Inactive (`active: false`)

| Source | URL | Type | Verified | Why |
|---|---|---|---|---|
| Epic Games Store News | `https://store.epicgames.com/en-US/news` | listing | no | The store, `epicgames.com/site/.../news` and `unrealengine.com` answer 403 (Cloudflare challenge), so they are not fetched. Routes tried: YouTube feeds for the three Epic channel ids found on `youtube.com/@EpicGamesStore` (`UC5Qk8mWBwtMyEj7iQQYRk1A`, `UCT16M1NqxN-OPc3E1rP8cmQ`, `UCrNC5OLd5jUHZb6DTtwjY9A`) answered 404 on every attempt (3 rounds); Google News `site:epicgames.com/site/en-US/news` returned 0 items and `site:store.epicgames.com` only returns product and cart pages, not news. A coverage query (`"Epic Games Store" free games`) works but is third-party reporting, not Epic's own voice, so it was not added. |
| CD PROJEKT (regulatory) | `https://www.cdprojekt.com/en/investors/regulatory-announcements/` | listing | no | 404 for every fetch (same WordPress quirk as the news root). Google News only returns third-party coverage of CD Projekt. The active `cd-projekt` news listing covers the company's own announcements. |

Moved to active in the fix round: Digital Foundry, Rockstar Newswire, Sony Group, Nintendo IR, Bandai Namco and Embracer (see the active table for routes). Original blocks: Digital Foundry tag feed stale since 2026-02-10 and `digitalfoundry.net` behind a Cloudflare challenge; Rockstar newswire JS shell with 500 on feeds; `sony.com` 403 (Akamai); Nintendo IR and Bandai Namco and Embracer press lists JS-rendered.

## Models and SDK

`@anthropic-ai/sdk` 1.3.0 is installed but not used until Task 8. `@anthropic-ai/sdk/helpers/zod` exports `zodOutputFormat`, and `client.beta.messages.parse` exists in the types.
