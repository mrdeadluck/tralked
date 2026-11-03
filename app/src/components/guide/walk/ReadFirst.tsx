import { walkInline } from "./inline";
import { SpoilerItemName, SpoilerNote } from "./spoilers";
import { noteScope, type MissableView, type NoteView } from "./view";

/*
 * "Leia isto para não perder nada": the walkthrough's read-first notes (amber for warnings, lime
 * for information), then every missable item as a chip with the chapter it belongs to. Notes and
 * items behind the spoiler gate (and hidden Steam achievements) arrive masked (view.ts) and fetch
 * their text only when the reader opens them.
 */

function MissableChip({ item, chapter }: MissableView) {
  const icon = item.achievement?.iconUrl;
  return (
    <li className="wk-mi">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" width={30} height={30} loading="lazy" />
      ) : (
        <span className="noimg" aria-hidden="true" />
      )}
      <span>
        {item.gated ? <SpoilerItemName id={`miss-${item.ref}`} itemRef={item.ref} what="o perdível" /> : item.name}
        <em>{chapter}</em>
      </span>
    </li>
  );
}

type ReadFirstProps = { notes: NoteView[]; missables: MissableView[] };

export function ReadFirst({ notes, missables }: ReadFirstProps) {
  return (
    <section id="g-leia" className="wk-sec" aria-labelledby="g-leia-h">
      <p className="wk-lbl">Antes de começar</p>
      <h2 id="g-leia-h">Leia isto para não perder nada</h2>
      <ul className="wk-read">
        {notes.map((note, i) => (
          <li key={i} className={note.tone === "aviso" ? "wk-r w" : "wk-r"}>
            <b>{note.title}</b>
            {note.text === null ? (
              <SpoilerNote id={`leia-${i}`} index={i} what={`o aviso ${note.title}`} />
            ) : (
              <p>{walkInline(note.text, noteScope(i))}</p>
            )}
          </li>
        ))}
      </ul>
      {missables.length > 0 ? (
        <>
          <p className="wk-lbl" style={{ marginTop: 18 }}>
            {missables.length === 1 ? "O perdível" : `Os ${missables.length} perdíveis`}
          </p>
          <ul className="wk-miss">
            {missables.map((m) => (
              <MissableChip key={m.item.ref} {...m} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
