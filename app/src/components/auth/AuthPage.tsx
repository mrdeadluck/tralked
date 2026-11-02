import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/**
 * Form card on the left; on the right what the account is for (the example sheet and the three
 * steps) and the "what next" notes. Stacked on small screens, the form first.
 */
export function AuthColumns({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid items-start gap-x-12 gap-y-10 min-[861px]:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-6">{children}</Card>
      <aside aria-label="O que você ganha com a conta" className="flex max-w-[560px] flex-col gap-5">
        {aside}
      </aside>
    </div>
  );
}

/** The aside's small print (links, the "never your platform password" note). */
export function AuthNotes({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 text-[14px] text-text-2">{children}</div>;
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
