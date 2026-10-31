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
43 sources: 35 active, 8 inactive. 12 have a dated `backfill` sitemap.

Notes for the collector:
- `kind: "rss"` covers RSS 2.0 and Atom (The Verge feeds are Atom).
- Send `Accept: text/html,application/xml;q=0.9,*/*;q=0.5` on listing fetches. CD PROJEKT returns 404 for some other Accept headers.
- `listingSelector` is a CSS selector for the item anchors. It also matches a few non-article links (section index pages), so de-duplicate and filter by URL pattern.
- A `backfill.url` may be a sitemap index (monthly children, e.g. PC Gamer `sitemap-2026-10.xml`) or a yearly/urlset file. The backfill code must follow indexes and keep only entries whose `lastmod` is inside the window.
- Entries with `gamingFilter: true` are general feeds; keep only items related to games.
- `cd-projekt` points at the year page `/en/media/news/2026/` (the section root intermittently returns 404). Update the year in January.

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
| Digital Foundry | `https://www.eurogamer.net/feed/tag/topics/digital-foundry` | rss | feed loads, but stale | Newest item is 2026-02-10; DF moved to `digitalfoundry.net`, which is behind a Cloudflare challenge (403, also for `/feed`). Re-enable if Eurogamer resumes the tag feed. |
| Rockstar Newswire | `https://www.rockstargames.com/newswire` | listing | no | Page is a 4 KB JS shell with no links; `/newswire/rss`, `/rss`, `/sitemap.xml` and the posts JSON endpoint all return HTTP 500. |
| Epic Games Store News | `https://store.epicgames.com/en-US/news` | listing | no | HTTP 403 (Cloudflare challenge) on the store, `epicgames.com/site/.../news` and `unrealengine.com`. No public feed found. |
| Sony Group (press) | `https://www.sony.com/en/SonyInfo/News/Press/` | listing | no | HTTP 403 "Access Denied" (Akamai). Sony Interactive's newsroom is used instead. |
| Nintendo (IR news) | `https://www.nintendo.co.jp/ir/en/news/index.html` | listing | no | List is rendered by JS; the static HTML has no news links. Nintendo news is covered by the active `nintendo-news` listing. |
| Bandai Namco Entertainment (press) | `https://www.bandainamcoent.co.jp/english/press/` | listing | no | List is rendered by JS. The holding site `bandainamco.co.jp` returns a 403 page. |
| CD PROJEKT (regulatory) | `https://www.cdprojekt.com/en/investors/regulatory-announcements/` | listing | no | Returns 404 for the fetches we tried (the same WordPress quirk as the news root). Re-test with a year query. |
| Embracer Group (press) | `https://embracer.com/news-media/pressreleases/` | listing | no | List is rendered by JS; the WordPress feeds return HTTP 500. |

## Models and SDK

`@anthropic-ai/sdk` 1.3.0 is installed but not used until Task 8. `@anthropic-ai/sdk/helpers/zod` exports `zodOutputFormat`, and `client.beta.messages.parse` exists in the types.
