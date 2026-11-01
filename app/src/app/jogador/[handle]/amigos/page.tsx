import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrivateProfile, SectionSkeleton } from "@/components/profile/PrivateProfile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { profilePath, ProfileTabs } from "@/components/profile/ProfileTabs";
import { PersonActions } from "@/components/social/PersonActions";
import { PersonList } from "@/components/social/PersonList";
import { prisma } from "@/lib/db";
import { profileAccess, sectionMetadata } from "@/lib/profile/access";
import { getProfileSummary } from "@/lib/profile/queries";
import type { PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";
import { listPeople, pendingRequests, socialCounts, type PeopleList } from "@/lib/social/relations";

export async function generateStaticParams() {
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]/amigos">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  return sectionMetadata(header, "Amigos", "/amigos", "Amigos, seguidores e quem este jogador segue no Tralked.");
}

const LISTS: { id: PeopleList; label: string; empty: string; since: string }[] = [
  { id: "amigos", label: "Amigos", empty: "Nenhum amigo ainda.", since: "amigos desde" },
  { id: "seguidores", label: "Seguidores", empty: "Ninguém segue este perfil ainda.", since: "segue desde" },
  { id: "seguindo", label: "Seguindo", empty: "Este perfil ainda não segue ninguém.", since: "seguindo desde" },
];

export default async function ProfileFriendsPage({ params, searchParams }: PageProps<"/jogador/[handle]/amigos">) {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SectionSkeleton label="Carregando amigos" />}>
      <ProfileFriends header={header} searchParams={searchParams} />
    </Suspense>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function ProfileFriends({
  header,
  searchParams,
}: {
  header: PlayerHeader;
  searchParams: PageProps<"/jogador/[handle]/amigos">["searchParams"];
}) {
  const { visible, isOwner } = await profileAccess(header);
  if (!visible) return <PrivateProfile displayName={header.displayName} />;

  const params = await searchParams;
  const list = LISTS.find((l) => l.id === one(params.lista)) ?? LISTS[0];
  const requested = Number(one(params.pagina) ?? "1");
  const [summary, counts, people, requests] = await Promise.all([
    getProfileSummary(header.id),
    socialCounts(prisma, header.id),
    listPeople(prisma, header.id, list.id, requested),
    isOwner ? pendingRequests(prisma, header.id) : Promise.resolve(null),
  ]);
  if (!summary) notFound();
  const base = profilePath(header.handle, "amigos");
  const countOf: Record<PeopleList, number> = { amigos: counts.friends, seguidores: counts.followers, seguindo: counts.following };
  const pageHref = (page: number) => `${base}?lista=${list.id}${page > 1 ? `&pagina=${page}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader summary={summary} section="Amigos" />
      <ProfileTabs handle={header.handle} active="amigos" />

      {requests && (requests.received.length > 0 || requests.sent.length > 0) ? (
        <section aria-labelledby="pedidos" className="flex flex-col gap-4 rounded-[4px] border border-acc/40 bg-acc/[0.04] p-5">
          <h2 id="pedidos" className="text-[18px] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
            Pedidos de amizade
          </h2>
          {requests.received.length > 0 ? (
            <PersonList
              people={requests.received}
              label="Pedidos recebidos"
              empty=""
              sinceLabel="pediu em"
              action={(p) => <PersonActions userId={p.id} handle={p.handle} ops={["accept", "decline"]} />}
            />
          ) : null}
          {requests.sent.length > 0 ? (
            <>
              <h3 className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">Enviados, esperando resposta</h3>
              <PersonList
                people={requests.sent}
                label="Pedidos enviados"
                empty=""
                sinceLabel="enviado em"
                action={(p) => <PersonActions userId={p.id} handle={p.handle} ops={["cancel"]} />}
              />
            </>
          ) : null}
        </section>
      ) : null}

      <nav aria-label="Listas" className="flex flex-wrap gap-2">
        {LISTS.map((l) => (
          <Link
            key={l.id}
            href={`${base}?lista=${l.id}`}
            aria-current={l.id === list.id ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-[2px] border px-3 font-mono text-[11px] tracking-[0.08em] uppercase ${
              l.id === list.id ? "border-text bg-text font-bold text-bg" : "border-line-2 text-text-3 hover:border-text hover:text-text"
            }`}
          >
            {l.label} <span className="ml-1.5 tabular-nums">{countOf[l.id].toLocaleString("pt-BR")}</span>
          </Link>
        ))}
      </nav>

      <PersonList people={people.people} label={list.label} empty={list.empty} sinceLabel={list.since} />

      {people.pageCount > 1 ? (
        <nav aria-label={`Páginas de ${list.label.toLowerCase()}`} className="flex items-center gap-4 font-mono text-[12px]">
          {people.page > 1 ? (
            <Link href={pageHref(people.page - 1)} className="text-acc underline underline-offset-2">
              ← Anterior
            </Link>
          ) : null}
          <span className="text-dim">
            Página {people.page} de {people.pageCount}
          </span>
          {people.page < people.pageCount ? (
            <Link href={pageHref(people.page + 1)} className="text-acc underline underline-offset-2">
              Próxima →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
