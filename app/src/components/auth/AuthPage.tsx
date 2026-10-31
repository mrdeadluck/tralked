import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/** Form card on the left, the "why / what next" notes on the right (stacked on small screens). */
export function AuthColumns({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid items-start gap-x-10 gap-y-8 min-[801px]:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-6">{children}</Card>
      <aside className="flex max-w-[52ch] flex-col gap-4 text-[14.5px] text-text-2">{aside}</aside>
    </div>
  );
}

/** "Entrar com o Google", only when Google login is configured. */
export function GoogleButton({ returnTo, label }: { returnTo: string; label: string }) {
  return (
    // A route handler redirect (OAuth), so a plain anchor.
    <a
      href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
      className="inline-flex h-11 items-center justify-center rounded-[2px] border border-line-2 px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-text uppercase hover:border-text"
    >
      {label}
    </a>
  );
}

export const TEXT_LINK = "text-acc underline underline-offset-2 hover:no-underline";
