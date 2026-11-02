/**
 * Crawlers that read the whole site to train AI models. On 01–02/11/2026 GPTBot alone made ~70% of
 * the requests (244k in two days, mostly /galeria, /jogos, /entrar and every game and forum page),
 * which burned the Vercel plan's CPU and took the site down. They are told to stay away in
 * robots.txt and answered 403 by the proxy before any page renders (some ignore robots.txt).
 *
 * Search engines (Googlebot, Bingbot) and AI *search* agents that cite the page to a person
 * (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Claude-User) stay allowed.
 */
export const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "omgili",
  "Timpibot",
] as const;

const PATTERN = new RegExp(AI_TRAINING_CRAWLERS.map((name) => name.replace(/[-]/g, "\\-")).join("|"), "i");

export function isAiTrainingCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && PATTERN.test(userAgent);
}
