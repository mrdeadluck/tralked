/**
 * Official YouTube channel feeds (`video: true` sources): which uploads become video stories.
 * Channels post far more than trailers (livestreams, podcasts, Shorts, esports, merch); only new
 * trailers and gameplay are worth an article, and the filter is a cheap title rule, before any AI call.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id of a youtube.com / youtu.be link (watch, embed, shorts), or null. */
export function youtubeIdOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  } else if (host === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export const isValidYoutubeId = (id: string | null | undefined): id is string => !!id && YOUTUBE_ID.test(id);

/** What makes an upload a trailer or gameplay video (English, Portuguese and Japanese channel titles). */
const TRAILER =
  /\b(trailers?|teasers?|gameplay|jogabilidade|reveal|revela[cç][aã]o|announce(ment)?|an[uú]ncio|launch|lan[cç]amento|first look|overview|showcase|walkthrough|demo)\b|トレーラー|ティザー|\bPV\b/i;

/** Uploads that are not news even when the title says "trailer" (streams, recaps, esports, ads, merch). */
const NOT_NEWS =
  /\b(live ?streams?|livestreams?|ao vivo|podcasts?|#shorts?|shorts|q ?& ?a|unboxing|asmr|reactions?|recap|highlights?|tournaments?|championships?|esports|accolades|merch|collectibles?|soundtrack|ost|music video|sale|promo)\b|配信/i;

/**
 * Whether a channel upload is a new trailer or gameplay video: the title names one and is not a stream,
 * a recap, an esports match, an accolades trailer or an ad, and the link is not a Short.
 */
export function isTrailerVideo(title: string, url: string): boolean {
  if (/\/shorts\//.test(url)) return false;
  return TRAILER.test(title) && !NOT_NEWS.test(title);
}
