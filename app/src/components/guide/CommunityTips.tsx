import Link from "next/link";
import { SectionHead } from "@/components/ui/SectionHead";
import { REACTION_RECEIVED_DAILY_CAP, REACTION_RECEIVED_XP, TIP_VOTE_XP } from "@/lib/community/rewards";
import type { GuideTipView } from "@/lib/queries/games";
import { loginHref } from "./format";
import { TipRow } from "./TipRow";

type CommunityTipsProps = {
  tips: GuideTipView[];
  loggedIn: boolean;
  returnTo: string;
  pending?: boolean;
};

/**
 * "Dicas da comunidade". Without a real tip the module is not drawn empty: a call to write the
 * first one takes its place (tips are written in the guide's comments, where each like pays the
 * author XP).
 */
export function CommunityTips({ tips, loggedIn, returnTo, pending }: CommunityTipsProps) {
  if (tips.length === 0) {
    return (
      <section id="g-dicas" data-sec aria-labelledby="g-dicas-cta" className="scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-[4px] border border-line-2 bg-surface px-5 py-5 min-[641px]:px-6">
          <div className="flex max-w-[60ch] flex-col gap-1.5">
            <h2 id="g-dicas-cta" className="text-[19px] leading-tight font-extrabold font-stretch-[105%]">
              Seja o primeiro a deixar uma dica
            </h2>
            <p className="text-[15px] text-muted">
              Ainda não há dicas de jogadores neste guia. Escreva a sua nos comentários: cada curtida no seu comentário
              vale <b className="font-mono font-bold whitespace-nowrap text-acc">+{REACTION_RECEIVED_XP} XP</b> para você,
              até {REACTION_RECEIVED_DAILY_CAP} por dia.{" "}
              <Link href="/como-funciona#de-onde-vem" className="whitespace-nowrap text-text-2 underline underline-offset-[3px] hover:text-acc">
                Como funciona o XP
              </Link>
            </p>
          </div>
          <a
            href={loggedIn ? "#comentarios" : loginHref(`${returnTo}#comentarios`)}
            className="inline-flex h-11 shrink-0 items-center rounded-[2px] bg-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-110"
          >
            Escrever uma dica
          </a>
        </div>
      </section>
    );
  }
  return (
    <section id="g-dicas" data-sec className="scroll-mt-24">
      <SectionHead
        title="Dicas da comunidade"
        aside={
          <span className="tracking-normal text-dim normal-case">
            Cada voto “útil” dá +{TIP_VOTE_XP} XP em Sábio ao autor
          </span>
        }
      />
      <ul className="m-0 list-none p-0">
        {tips.map((tip) => (
          <TipRow key={tip.id} tip={tip} loggedIn={loggedIn} returnTo={returnTo} pending={pending} />
        ))}
      </ul>
    </section>
  );
}
