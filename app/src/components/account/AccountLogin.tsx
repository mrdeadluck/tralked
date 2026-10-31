import { Card } from "@/components/ui/Card";

const LINK =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase";

/** Shown on the account pages to visitors without a session. */
export function AccountLogin({ returnTo, google }: { returnTo: string; google: boolean }) {
  const query = `returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <Card className="flex max-w-[640px] flex-col items-start gap-4">
      <h2 className="text-[19px] font-extrabold font-stretch-[105%]">Entre para ver sua conta</h2>
      <p className="text-muted">
        Aqui você conecta PlayStation, Xbox e RetroAchievements, edita sua bio, escolhe quem vê seu
        personagem e baixa ou exclui seus dados. O Tralked nunca pede sua senha.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/auth/steam?${query}`} className={`${LINK} border-acc bg-acc text-bg hover:brightness-[1.08]`}>
          Entrar com a Steam
        </a>
        {google ? (
          <a href={`/api/auth/google?${query}`} className={`${LINK} border-line-2 text-text hover:border-text`}>
            Entrar com o Google
          </a>
        ) : null}
      </div>
    </Card>
  );
}
