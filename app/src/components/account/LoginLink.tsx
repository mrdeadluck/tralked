import Link from "next/link";
import { loginHref } from "@/components/guide/format";

/** "Entrar" button: the Tralked login, coming back to `returnTo` (a same-origin path). */
export function LoginLink({ returnTo }: { returnTo: string }) {
  return (
    <Link
      href={loginHref(returnTo)}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
    >
      Entrar
    </Link>
  );
}
