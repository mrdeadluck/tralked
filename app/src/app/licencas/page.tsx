import type { Metadata } from "next";
import { PageHead } from "@/components/community/PageHead";
import { LegalSection } from "@/components/legal/LegalSection";
import { DATA_SOURCES, FONTS, SOFTWARE, type LicenseEntry } from "@/lib/legal/licenses";

export const metadata: Metadata = {
  title: "Licenças | Tralked",
  description: "Software livre, fontes e fontes de dados usados pelo Tralked, com as respectivas licenças.",
};

function LicenseList({ entries }: { entries: LicenseEntry[] }) {
  return (
    <ul className="m-0 list-none border-t border-divider p-0">
      {entries.map((entry) => (
        <li key={entry.name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-divider py-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="font-bold">
              {entry.name}
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
            {entry.note ? <span className="text-[14px] text-muted">{entry.note}</span> : null}
          </span>
          <span className="font-mono text-[12px] text-dim">{entry.license}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LicencasPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-10">
      <PageHead
        title="Licenças"
        lede="O Tralked é feito com software livre e com dados públicos de plataformas de jogos. Obrigado a quem mantém cada um deles."
      />
      <LegalSection id="software" title="Software">
        <div>
          <LicenseList entries={SOFTWARE} />
        </div>
      </LegalSection>
      <LegalSection id="fontes-tipograficas" title="Fontes tipográficas">
        <div>
          <LicenseList entries={FONTS} />
        </div>
      </LegalSection>
      <LegalSection id="dados" title="Dados e imagens">
        <p>
          Nomes, capas, artes e conquistas dos jogos pertencem aos seus donos e aparecem aqui para
          identificar os jogos. As imagens da Steam são exibidas direto dos servidores da Steam.
        </p>
        <div>
          <LicenseList entries={DATA_SOURCES} />
        </div>
      </LegalSection>
    </div>
  );
}
