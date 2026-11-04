import type { GuideSource } from "@/lib/queries/games";
import type { ItemView } from "./view";

/*
 * "Créditos": every page the guide was written from, once, at the end of the guide. The guide
 * speaks with its own voice: the items do not repeat their sources to the reader (readers found the
 * "Fonte: …" line under each item tiring, 2026-11-04); the staff preview still shows them per item.
 */

type Credit = { name: string; url: string | null };

/** The guide's sources, then the ones its items cite, one per name (the first link wins). */
export function creditsOf(sources: GuideSource[], items: ItemView[]): Credit[] {
  const byName = new Map<string, Credit>();
  const add = (name: string, url: string | null) => {
    const known = byName.get(name);
    if (!known) byName.set(name, { name, url });
    else if (!known.url && url) known.url = url;
  };
  for (const s of sources) add(s.title, s.url);
  for (const item of items) for (const s of item.sources) add(s.name, s.url);
  return [...byName.values()];
}

export function GuideCredits({ credits }: { credits: Credit[] }) {
  if (credits.length === 0) return null;
  return (
    <section id="g-creditos" className="wk-sec wk-credits" aria-labelledby="g-creditos-h">
      <p className="wk-lbl">De onde vem este guia</p>
      <h2 id="g-creditos-h">Créditos</h2>
      <p className="wk-credits-note">
        A equipe Tralked escreveu este guia cruzando as páginas abaixo. As imagens levam o crédito de quem as fez.
      </p>
      <ul>
        {credits.map((c) => (
          <li key={c.name}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                {c.name}
              </a>
            ) : (
              c.name
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
