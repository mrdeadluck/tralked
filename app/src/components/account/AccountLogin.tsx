import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { loginHref } from "@/components/guide/format";

const LINK =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase";

/** Shown on the account pages to visitors without a session. */
export function AccountLogin({ returnTo }: { returnTo: string }) {
  return (
    <Card className="flex max-w-[640px] flex-col items-start gap-4">
      <h2 className="text-[19px] font-extrabold font-stretch-[105%]">Entre para ver sua conta</h2>
      <p className="text-muted">
        Aqui você conecta Steam, PlayStation, Xbox e RetroAchievements, edita sua bio, escolhe quem vê seu
        personagem e baixa ou exclui seus dados. O Tralked nunca pede a senha de outros serviços.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={loginHref(returnTo)} className={`${LINK} border-acc bg-acc text-bg hover:brightness-[1.08]`}>
          Entrar
        </Link>
        <Link href="/cadastrar" className={`${LINK} border-line-2 text-text hover:border-text`}>
          Criar conta
        </Link>
      </div>
    </Card>
  );
}
