import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AcceptInviteButton } from "@/components/family/AcceptInviteButton";
import { FamilyMembers } from "@/components/family/FamilyMembers";
import { SteamLoginLink } from "@/components/family/SteamLoginLink";
import { Card } from "@/components/ui/Card";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import {
  getFamilyOverviewForUser,
  getInvitePreview,
  INVITE_ERROR_MESSAGES,
  MAX_FAMILY_MEMBERS,
} from "@/lib/family/service";

export const metadata: Metadata = {
  title: "Convite para a Família GAMELOG",
  // Invite links are private: keep them out of search indexes.
  robots: { index: false, follow: false },
};

export default function ConvitePage({ params }: PageProps<"/familia/convite/[token]">) {
  return (
    <Suspense fallback={<p className="py-10 font-mono text-xs text-dim">Carregando o convite…</p>}>
      <ConviteContent params={params} />
    </Suspense>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mt-5 flex max-w-[640px] flex-col items-start gap-4">
      <p role="alert" className="text-text">
        {children}
      </p>
      <Link href="/familia" className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
        Ir para a Família GAMELOG →
      </Link>
    </Card>
  );
}

async function ConviteContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, preview] = await Promise.all([getSessionUser(), getInvitePreview(token)]);
  const head = <SectionHead title="Convite para a família" aside="Família GAMELOG" />;

  if (preview.status !== "ok") {
    return (
      <div>
        {head}
        <Message>{INVITE_ERROR_MESSAGES[preview.status]}</Message>
      </div>
    );
  }

  const { family } = preview;

  if (!user) {
    return (
      <div>
        {head}
        <Card className="mt-5 flex max-w-[640px] flex-col items-start gap-4">
          <h3 className="text-[19px] font-extrabold font-stretch-[105%]">
            Você foi convidado para a família &quot;{family.name}&quot;
          </h3>
          <p className="text-muted">
            A Família GAMELOG junta as bibliotecas Steam dos membros: quem tem cada jogo, ranking do grupo e
            o que está perto do 100%. Entre com a Steam para aceitar o convite. Não pedimos senha da Steam.
          </p>
          <SteamLoginLink returnTo={`/familia/convite/${token}`} />
        </Card>
      </div>
    );
  }

  const alreadyInFamily = await getFamilyOverviewForUser(user.id);

  return (
    <div>
      {head}
      <div className="mt-5 flex max-w-[640px] flex-col gap-5">
        <Card className="flex flex-col gap-4">
          <h3 className="text-[19px] font-extrabold font-stretch-[105%]">
            Família &quot;{family.name}&quot;
          </h3>
          <FamilyMembers members={family.members} maxMembers={MAX_FAMILY_MEMBERS} />
          {alreadyInFamily ? (
            <p role="alert" className="text-text">
              {INVITE_ERROR_MESSAGES.already_in_family}
            </p>
          ) : preview.full ? (
            <p role="alert" className="text-text">
              {INVITE_ERROR_MESSAGES.full}
            </p>
          ) : (
            <AcceptInviteButton token={token} />
          )}
          {alreadyInFamily ? (
            <Link href="/familia" className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
              Ir para a minha família →
            </Link>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
