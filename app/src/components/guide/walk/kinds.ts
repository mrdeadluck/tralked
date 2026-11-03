/*
 * How a collectible kind is written next to its count. The kinds are the English nouns of the game
 * ("Bell", "Memory Flower", "Blackstone Fragment"): the plural changes the last word only, by the
 * English rules, and a word already in the plural ("Tales", "Weapons") stays as it is.
 */

function pluralWord(word: string): string {
  // A single final s after another letter reads as a plural already ("Tales", "Weapons");
  // -ss, -us and -is are singular ("Boss", "Bonus", "Iris").
  if (/[^sui]s$/i.test(word)) return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** The kind as it reads beside `count`: singular for 1, plural otherwise ("2 Bells", "1 Bell"). */
export function kindLabel(kind: string, count: number): string {
  if (count === 1) return kind;
  const at = kind.lastIndexOf(" ") + 1;
  return kind.slice(0, at) + pluralWord(kind.slice(at));
}
