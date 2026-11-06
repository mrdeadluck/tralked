/**
 * Games whose news goes to another catalog entry (Lucas, 05/11/2026: "qualquer matéria sobre Mass
 * Effect 1, 2 ou 3 aparece no Mass Effect Legendary Edition apenas"). The catalog keeps one entry per
 * edition (Mass Effect 2 Collector's Edition, Mass Effect 3 N7…); news about any of them is linked to the
 * destination instead, so its page, art and achievements are the ones readers see.
 *
 * `match` runs on the game's name and on its slug read as words ("mass-effect-2" → "mass effect 2").
 */
export type GameDestination = { slug: string; name: string; match: RegExp; except?: RegExp };

export const GAME_DESTINATIONS: GameDestination[] = [
  {
    slug: "mass-effect-legendary-edition",
    name: "Mass Effect Legendary Edition",
    // Mass Effect, Mass Effect 2, Mass Effect 3 (II, III), any edition; not glued spellings ("Mass
    // Effect™: Andromeda") nor a later numbered game ("Mass Effect 4", the next one).
    match: new RegExp(String.raw`^mass effect(?:\s+(?:[123]|ii|iii)(?![\w™])|(?![\w™])(?!\s+(?:\d|iv\b|v\b)))`, "i"),
    except: /andromeda|corsair|team assault|infiltrator|galaxy|foundation/i,
  },
];

const COMBINING_MARKS = new RegExp(String.raw`[̀-ͯ]`, "g");

const words = (text: string) =>
  text.normalize("NFD").replace(COMBINING_MARKS, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** Where news about the game `nameOrSlug` goes, or null when it stays where it is. */
export function gameDestination(nameOrSlug: string): { slug: string; name: string } | null {
  const text = words(nameOrSlug);
  const rule = GAME_DESTINATIONS.find((r) => r.match.test(text) && !r.except?.test(text));
  return rule ? { slug: rule.slug, name: rule.name } : null;
}
