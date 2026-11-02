/**
 * "Feito pela redação, vigiado por você": how the bylines work. A dark card of the system (same
 * head as "Missão de hoje"), with the two byline marks a reader meets on every story.
 */
export function EditorialCard() {
  return (
    <section aria-labelledby="editorial-titulo" className="rounded-[4px] border border-line bg-surface p-[22px]">
      <div className="mb-1 border-b border-[#23252c] pb-3.5">
        <h2
          id="editorial-titulo"
          className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] text-balance uppercase"
        >
          Feito pela redação, <span className="text-acc">vigiado por você</span>
        </h2>
      </div>
      <p className="pt-3 text-[14.5px] leading-snug text-text-2">
        Cada notícia diz quem escreveu. Achou um erro? Comente ou denuncie na própria página.
      </p>
      <ul aria-label="Assinaturas das notícias" className="m-0 mt-4 flex list-none flex-col gap-2 p-0 font-mono text-xs">
        <li className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
            Autoria humana
          </span>
          <span className="text-dim">escrita por alguém da redação</span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-text-2 before:size-1.5 before:rounded-full before:bg-dim before:content-['']">
            Equipe Tralked
          </span>
          <span className="text-dim">escrita pelo robô de notícias</span>
        </li>
      </ul>
    </section>
  );
}
