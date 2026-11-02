import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { PageHead } from "@/components/community/PageHead";
import { CaseItem, CaseShelf } from "@/components/shelf/CaseShelf";
import { Chip } from "@/components/ui/Chip";
import { caseArt, steamAppIdFromUrl } from "@/lib/case-art";
import {
  getReleaseList,
  RELEASE_FILTERS,
  RELEASE_TABS,
  RELEASES_TAG,
  type ReleaseFilter,
  type ReleaseTab,
} from "@/lib/queries/releases";
import { RELEASE_PLATFORM_COLOR, RELEASE_PLATFORM_LABEL } from "@/lib/releases/platforms";

const filterLabel = (f: ReleaseFilter) => (f === "TODAS" ? "Todas" : RELEASE_PLATFORM_LABEL[f]);
export const releasesHref = (tab: ReleaseTab, filter: ReleaseFilter) => `/lancamentos/${tab}/${filter.toLowerCase()}`;

/**
 * /lancamentos: the full list of a tab and platform, grouped by day. Tabs and filters are plain
 * links to static pages (`/lancamentos/<aba>/<plataforma>`), so everything works without JavaScript.
 */
export async function ReleasesList({ tab, filter }: { tab: ReleaseTab; filter: ReleaseFilter }) {
  "use cache";
  cacheLife("hours");
  cacheTag(RELEASES_TAG);

  const { releases, consolesOff } = await getReleaseList(tab, filter, new Date());
  const groups: { label: string; items: typeof releases }[] = [];
  for (const r of releases) {
    const label = r.day ? r.dateText : "Data a definir";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }
  const tabInfo = RELEASE_TABS.find((t) => t.id === tab)!;

  return (
    <div key="releases-list" className="flex w-full flex-col gap-8">
      <PageHead
        title="Lançamentos"
        lede="Os jogos que acabaram de sair e os que estão chegando, do PC (Steam) aos consoles. Datas da Steam e do IGDB, atualizadas a cada 6 horas."
      />
      <nav aria-label="Período" className="flex gap-1 border-b border-line-2">
        {RELEASE_TABS.map((t) => (
          <Link
            key={t.id}
            href={releasesHref(t.id, filter)}
            aria-current={t.id === tab ? "page" : undefined}
            className={`flex h-11 items-center px-3.5 font-mono text-[12px] tracking-[0.08em] uppercase ${
              t.id === tab ? "text-text shadow-[inset_0_-2px_0_var(--acc)]" : "text-text-3 hover:text-text"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs tracking-normal text-dim normal-case">{t.hint}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Plataforma" className="-mt-3 flex flex-wrap gap-1.5">
        {RELEASE_FILTERS.map((f) => (
          <Link
            key={f}
            href={releasesHref(tab, f)}
            aria-current={f === filter ? "page" : undefined}
            className={`border px-2.5 py-1 font-mono text-xs tracking-[0.06em] uppercase ${
              f === filter ? "border-text bg-hover text-text" : "border-line-2 text-text-3 hover:text-text"
            }`}
          >
            {filterLabel(f)}
          </Link>
        ))}
      </nav>
      {consolesOff ? (
        <p className="border-l-2 border-line-2 pl-3 text-[14px] text-muted">
          Lançamentos de PlayStation, Xbox e Nintendo ainda não estão ligados: falta configurar a integração com o
          IGDB. Os do PC vêm da Steam.
        </p>
      ) : null}
      <p className="-mt-4 font-mono text-xs tracking-[0.06em] text-dim">
        {releases.length} {releases.length === 1 ? "JOGO" : "JOGOS"} · {tabInfo.hint.toUpperCase()} · {filterLabel(filter).toUpperCase()}
      </p>
      {groups.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {groups.map((g) => (
            <li key={g.label} className="flex flex-col gap-4">
              <h2 className="border-b border-line pb-2 font-mono text-[12px] tracking-[0.08em] text-text-3 uppercase">
                {g.label}
                {g.items[0].relative ? <span className="ml-2 text-dim normal-case">{g.items[0].relative}</span> : null}
              </h2>
              <CaseShelf>
                {g.items.map((r) => (
                  <CaseItem
                    key={r.gameId}
                    href={`/jogos/${r.slug}`}
                    slug={r.slug}
                    name={r.name}
                    art={caseArt({
                      coverUrl: r.coverUrl,
                      steamAppId: steamAppIdFromUrl(r.capsuleUrl),
                      wideUrl: r.capsuleUrl,
                      portraitChecked: !r.stub,
                    })}
                  >
                    <span className="cs-name">{r.name}</span>
                    <span className="cs-meta">
                      {r.platforms.map((p) => (
                        <Chip key={p} color={RELEASE_PLATFORM_COLOR[p]}>
                          {RELEASE_PLATFORM_LABEL[p]}
                        </Chip>
                      ))}
                      {r.stub ? <span>detalhes em breve</span> : null}
                    </span>
                  </CaseItem>
                ))}
              </CaseShelf>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-6 text-[15px] text-muted">
          {tab === "ultimos" ? "Nenhum lançamento nos últimos 30 dias" : "Nenhum lançamento previsto para os próximos 90 dias"}{" "}
          {filter === "TODAS" ? "" : `em ${filterLabel(filter)}`}.
        </p>
      )}
      <p className="text-[13px] text-dim">
        Também no <Link href="/calendario" className="text-acc underline underline-offset-2">calendário</Link>, junto com as
        matérias publicadas.
      </p>
    </div>
  );
}
