import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AccountNav } from "@/components/account/AccountNav";
import { CaseIntroSetting } from "@/components/account/CaseIntroSetting";
import { CredentialsForms } from "@/components/account/CredentialsForms";
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm";
import { EmailStatus } from "@/components/account/EmailStatus";
import { ProfileForm } from "@/components/account/ProfileForm";
import { PageHead } from "@/components/community/PageHead";
import { DmPolicyForm } from "@/components/social/DmPolicyForm";
import { PersonActions } from "@/components/social/PersonActions";
import { PersonList } from "@/components/social/PersonList";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { mailAvailable } from "@/lib/mail/mailer";
import { DM_POLICIES, type DmPolicy } from "@/lib/social/messages";
import { listBlocked } from "@/lib/social/relations";

export const metadata: Metadata = {
  title: "Conta · Tralked",
  description: "Bio, privacidade do personagem, exportação e exclusão dos seus dados no Tralked.",
  robots: { index: false },
};

export default function ContaPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead title="Conta" />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando a conta…</p>}>
        <ContaContent />
      </Suspense>
    </div>
  );
}

function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-b border-line pb-10 min-[801px]:grid-cols-[240px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          {title}
        </h2>
        {lede ? <p className="text-[13.5px] text-muted">{lede}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

async function ContaContent() {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/conta" />;
  const blocked = await listBlocked(prisma, user.id);

  return (
    <>
      <AccountNav current="/conta" />
      <Section title="Perfil" lede={`Você aparece como ${user.displayName} (@${user.handle}).`}>
        <ProfileForm bio={user.bio ?? ""} profilePublic={user.profilePublic} handle={user.handle} />
      </Section>

      <Section title="Mensagens e bloqueios" lede="Quem pode falar com você em particular, e quem você bloqueou.">
        <div id="mensagens" className="flex scroll-mt-24 flex-col gap-6">
          <DmPolicyForm policy={(DM_POLICIES as readonly string[]).includes(user.dmPolicy) ? (user.dmPolicy as DmPolicy) : "everyone"} />
          <div className="flex flex-col gap-3">
            <h3 className="text-[15px] font-bold">Bloqueados</h3>
            <PersonList
              people={blocked}
              label="Pessoas bloqueadas"
              empty="Você não bloqueou ninguém. Para bloquear, use o botão Bloquear no perfil ou na conversa."
              sinceLabel="bloqueado em"
              action={(p) => <PersonActions userId={p.id} handle={p.handle} ops={["unblock"]} />}
            />
          </div>
        </div>
      </Section>

      <Section title="Capinha dos jogos" lede="A animação de abrir o lacre na primeira visita a cada jogo.">
        <CaseIntroSetting off={user.caseIntroOff} />
      </Section>

      <Section title="E-mail e senha" lede="Com eles você entra no Tralked. A senha é só do Tralked.">
        <div className="flex flex-col gap-8">
          <EmailStatus email={user.email} verified={user.emailVerifiedAt !== null} mailOn={mailAvailable()} />
          <CredentialsForms email={user.email} hasPassword={user.passwordHash !== null} />
        </div>
      </Section>

      <Section title="Seus dados" lede="Uma cópia de tudo o que o Tralked guarda sobre você, em JSON.">
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-[60ch] text-[14.5px] text-text-2">
            Inclui perfil, contas conectadas, biblioteca, conquistas, histórico de XP, missões,
            comentários, posts, fotos, curtidas, quem você segue, amizades, bloqueios, reações, as
            mensagens que você enviou e notificações. Só os seus dados, nunca os de outras pessoas.
          </p>
          {/* A route handler download, so a plain anchor (not next/link). */}
          <a
            href="/conta/exportar"
            download
            className="inline-flex h-11 items-center justify-center rounded-[2px] border border-line-2 px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-text uppercase hover:border-text"
          >
            Baixar meus dados (JSON)
          </a>
        </div>
      </Section>

      <Section
        title="Conexões"
        lede="Steam, PlayStation, Xbox e RetroAchievements somam no mesmo personagem."
      >
        <Link href="/conta/conexoes" className="font-semibold text-acc underline underline-offset-4 hover:no-underline">
          Gerenciar plataformas conectadas →
        </Link>
      </Section>

      <Section title="Excluir conta" lede="Pela LGPD, você pode apagar sua conta quando quiser. Não dá para desfazer.">
        <DeleteAccountForm />
      </Section>
    </>
  );
}
