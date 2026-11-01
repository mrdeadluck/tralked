import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReleasesList } from "@/components/releases/ReleasesList";
import { RELEASE_FILTERS, RELEASE_TABS, parseReleaseTab, type ReleaseFilter } from "@/lib/queries/releases";
import { RELEASE_PLATFORM_LABEL } from "@/lib/releases/platforms";

/** Every tab × platform is prerendered: ten small static pages, readable without JavaScript. */
export function generateStaticParams() {
  return RELEASE_TABS.flatMap((t) => RELEASE_FILTERS.map((f) => ({ aba: t.id, plataforma: f.toLowerCase() })));
}

function parse(aba: string, plataforma: string) {
  const tab = parseReleaseTab(aba);
  const filter = RELEASE_FILTERS.find((f) => f.toLowerCase() === plataforma) as ReleaseFilter | undefined;
  return tab && filter ? { tab, filter } : null;
}

export async function generateMetadata({ params }: PageProps<"/lancamentos/[aba]/[plataforma]">): Promise<Metadata> {
  const { aba, plataforma } = await params;
  const view = parse(aba, plataforma);
  if (!view) return {};
  const tab = RELEASE_TABS.find((t) => t.id === view.tab)!;
  const platform = view.filter === "TODAS" ? "todas as plataformas" : RELEASE_PLATFORM_LABEL[view.filter];
  return {
    title: `Lançamentos: ${tab.label.toLowerCase()} (${platform}) | Tralked`,
    description: `Lançamentos de jogos dos ${tab.hint}, ${platform}.`,
    // The default view (últimos, PC) is also /lancamentos: one canonical URL for it.
    alternates: {
      canonical: view.tab === "ultimos" && view.filter === "PC" ? "/lancamentos" : `/lancamentos/${view.tab}/${plataforma}`,
    },
  };
}

export default async function LancamentosFiltroPage({ params }: PageProps<"/lancamentos/[aba]/[plataforma]">) {
  const { aba, plataforma } = await params;
  const view = parse(aba, plataforma);
  if (!view) notFound();
  return <ReleasesList tab={view.tab} filter={view.filter} />;
}
