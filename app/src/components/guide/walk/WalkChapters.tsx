import type { Walkthrough } from "@/lib/content/walkthrough-schema";

/*
 * The walkthrough itself (stub): the list of chapters. The full version, with scenes, steps,
 * items to tick and the green trail, replaces this one.
 */
export function WalkChapters({ walkthrough }: { walkthrough: Walkthrough }) {
  return (
    <section id="g-detonado" className="wk-sec" aria-labelledby="g-detonado-h">
      <p className="wk-lbl">Detonado</p>
      <h2 id="g-detonado-h">Do início ao Tralked</h2>
      <ol className="wk-chapters">
        {walkthrough.chapters.map((c) => {
          const items = c.steps.reduce((n, s) => n + s.items.length, 0);
          return (
            <li key={c.key}>
              <span>
                <b>{c.title}</b>
                {c.region ? <small> · {c.region}</small> : null}
              </span>
              <small>
                {c.hours} · {c.steps.length} passos · {items} itens
              </small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
