import { env } from "@/lib/env";

/*
 * schema.org structured data (JSON-LD) for articles, games and guides. Builders are pure; the
 * <JsonLd> component serializes with every character that could close the <script> (or start
 * an HTML comment/entity) escaped, because titles and texts come from users, robots and APIs.
 */

export const SITE_NAME = "Tralked";

/** Absolute URL of a site path (APP_URL is the public origin). */
export function absoluteUrl(path: string): string {
  return new URL(path, env.APP_URL).toString();
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
export type JsonLdObject = { "@context": "https://schema.org"; "@type": string; [key: string]: JsonValue | undefined };

/** JSON safe inside <script>: `<`, `>`, `&` and the JS line separators become \u escapes. */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(LINE_SEPARATOR, "\\u2028")
    .replaceAll(PARAGRAPH_SEPARATOR, "\\u2029");
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function JsonLd({ data }: { data: JsonLdObject }) {
  // The only HTML string here is JSON with every markup character escaped (see serializeJsonLd).
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

const publisher = () => ({
  "@type": "Organization",
  name: SITE_NAME,
  url: absoluteUrl("/"),
  logo: { "@type": "ImageObject", url: absoluteUrl("/opengraph-image") },
});

/** Only absolute http(s) images belong in structured data. */
const httpImage = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined);

export type NewsArticleInput = {
  slug: string;
  title: string;
  excerpt: string | null;
  authorLabel: string;
  bot: boolean;
  publishedAt: Date;
  imageUrl: string | null;
  heroUrl?: string | null;
  games: { name: string }[];
};

export function newsArticleJsonLd(article: NewsArticleInput): JsonLdObject {
  const image = httpImage(article.imageUrl) ?? httpImage(article.heroUrl);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title.slice(0, 110),
    description: article.excerpt ?? undefined,
    url: absoluteUrl(`/noticias/${article.slug}`),
    mainEntityOfPage: absoluteUrl(`/noticias/${article.slug}`),
    datePublished: article.publishedAt.toISOString(),
    image: image ? [image] : [absoluteUrl("/opengraph-image")],
    author: article.bot
      ? { "@type": "Organization", name: article.authorLabel }
      : { "@type": "Person", name: article.authorLabel.replace(/^@/, "") },
    publisher: publisher(),
    about: article.games.length > 0 ? article.games.map((g) => ({ "@type": "VideoGame", name: g.name })) : undefined,
    inLanguage: "pt-BR",
  };
}

const PLATFORM_NAMES: Record<string, string> = {
  PLAYSTATION: "PlayStation",
  XBOX: "Xbox",
  NINTENDO: "Nintendo",
  PC: "PC",
};

export type VideoGameInput = {
  slug: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  platforms: string[];
  /** Total achievements (Steam). */
  achievementCount?: number;
};

/** VideoGame for /jogos/[slug]: render `<JsonLd data={videoGameJsonLd(game)} />` on the game page. */
export function videoGameJsonLd(game: VideoGameInput): JsonLdObject {
  const image = httpImage(game.coverUrl);
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.name,
    description: game.summary ?? undefined,
    url: absoluteUrl(`/jogos/${game.slug}`),
    image,
    gamePlatform: game.platforms.map((p) => PLATFORM_NAMES[p] ?? p),
    inLanguage: "pt-BR",
  };
}

export type HowToInput = {
  game: { slug: string; name: string; summary: string | null };
  /** The guide's time to 100% (the same as the game page); null leaves totalTime out. */
  facts: { timeTo100: { minutes: number } | null };
  overview: string[];
  steps: { order: number; title: string; body: string }[];
};

/** HowTo for /jogos/[slug]/guia: the route to 100% as ordered steps. */
export function howToJsonLd(guide: HowToInput): JsonLdObject {
  const url = absoluteUrl(`/jogos/${guide.game.slug}/guia`);
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `Guia de conquistas 100%: ${guide.game.name}`,
    description: guide.overview[0] ?? guide.game.summary ?? undefined,
    url,
    totalTime: guide.facts.timeTo100 ? `PT${Math.max(1, Math.round(guide.facts.timeTo100.minutes / 60))}H` : undefined,
    about: { "@type": "VideoGame", name: guide.game.name, url: absoluteUrl(`/jogos/${guide.game.slug}`) },
    step: guide.steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.title,
      text: step.body || step.title,
      url: `${url}#g-rota`,
    })),
    inLanguage: "pt-BR",
  };
}
