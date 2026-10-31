import type { Metadata } from "next";
import { Suspense } from "react";
import { FamilyAlmost } from "@/components/family/FamilyAlmost";
import { FamilyLibrary } from "@/components/family/FamilyLibrary";
import { FamilyMembers } from "@/components/family/FamilyMembers";
import { FamilyRanking } from "@/components/family/FamilyRanking";
import { CreateFamilyForm } from "@/components/family/CreateFamilyForm";
import { InvitePanel } from "@/components/family/InvitePanel";
import { LeaveFamilyButton } from "@/components/family/LeaveFamilyButton";
import { SteamLoginLink } from "@/components/family/SteamLoginLink";
import { Card } from "@/components/ui/Card";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { SKILLS } from "@/lib/engine/types";
import {
  almostThere,
  FAMILY_NAME_MAX,
  getFamilyLibrary,
  getFamilyOverviewForUser,
  getFamilyRanking,
  MAX_FAMILY_MEMBERS,
  type FamilyRankingRow,
} from "@/lib/family/service";

export const metadata: Metadata = {
  title: "Família Tralked",
  description:
    "Junte as bibliotecas Steam de quem joga com você: veja quem tem cada jogo, o ranking da família e o que está perto do 100%.",
};

export default function FamiliaPage() {
  return (
    <Suspense fallback={<p className="py-10 font-mono text-xs text-dim">Carregando a família…</p>}>
      <FamiliaContent />
    </Suspense>
  );
}

function Intro({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHead
        title="Família Tralked"
        aside="Até 6 pessoas · por convite"
      />
      {children}
    </div>
  );
}

async function FamiliaContent() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <Intro>
        <Card className="mt-5 flex max-w-[640px] flex-col items-start gap-4">
          <h3 className="text-[19px] font-extrabold font-stretch-[105%]">Jogue em família, sem compartilhar senha</h3>
          <p className="text-muted">
            A Família Tralked junta as bibliotecas Steam de quem você convidar: veja quem tem cada jogo, o
            ranking do grupo e o que está perto do 100%. Funciona por link de convite, sem mexer na Família
            Steam e sem pedir senha da Steam.
          </p>
          <SteamLoginLink returnTo="/familia" />
        </Card>
      </Intro>
    );
  }

  const family = await getFamilyOverviewForUser(user.id);

  if (!family) {
    const defaultName = `Família ${user.displayName}`.slice(0, FAMILY_NAME_MAX);
    return (
      <Intro>
        <Card className="mt-5 flex max-w-[640px] flex-col gap-4">
          <h3 className="text-[19px] font-extrabold font-stretch-[105%]">Criar família</h3>
          <p className="text-muted">
            Você será o dono e poderá gerar links de convite. Quem entrar precisa deixar o perfil Steam
            público para a biblioteca aparecer.
          </p>
          <CreateFamilyForm defaultName={defaultName} />
        </Card>
      </Intro>
    );
  }

  const skillIds = SKILLS.map((s) => s.id);
  const [library, rankingLists] = await Promise.all([
    getFamilyLibrary(family.id),
    Promise.all(["geral" as const, ...skillIds].map((key) => getFamilyRanking(family.id, key))),
  ]);
  const rankings: Record<string, FamilyRankingRow[]> = Object.fromEntries(
    ["geral", ...skillIds].map((key, index) => [key, rankingLists[index]]),
  );
  const almost = almostThere(library);
  const isOwner = family.ownerId === user.id;

  return (
    <div className="flex flex-col gap-12">
      <section>
        <SectionHead
          title={family.name}
          aside={`${family.members.length} ${family.members.length === 1 ? "membro" : "membros"}`}
        />
        <FamilyLibrary entries={library} />
      </section>

      <div className="grid gap-10 nav:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-12">
          <section>
            <SectionHead title="Ranking da família" aside="Só perfis públicos" />
            <FamilyRanking rankings={rankings} meHandle={user.handle} />
          </section>
          <section>
            <SectionHead title="Quase lá da família" aside="Melhor membro com 70% ou mais" />
            <FamilyAlmost entries={almost} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4">
            <SectionHead title="Membros" />
            <FamilyMembers members={family.members} maxMembers={MAX_FAMILY_MEMBERS} meId={user.id} />
          </section>
          <InvitePanel memberCount={family.members.length} maxMembers={MAX_FAMILY_MEMBERS} />
          <div>
            <LeaveFamilyButton isOwner={isOwner} isLastMember={family.members.length === 1} />
          </div>
        </aside>
      </div>
    </div>
  );
}
