import { SectionHead } from "@/components/ui/SectionHead";
import type { GuideTipView } from "@/lib/queries/games";
import { TipRow } from "./TipRow";

type CommunityTipsProps = {
  tips: GuideTipView[];
  loggedIn: boolean;
  returnTo: string;
};

export function CommunityTips({ tips, loggedIn, returnTo }: CommunityTipsProps) {
  return (
    <section id="g-dicas" data-sec className="scroll-mt-24">
      <SectionHead
        title="Dicas da comunidade"
        aside={<span className="tracking-normal text-dim normal-case">Votos dão XP Sábio para o autor</span>}
      />
      {tips.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {tips.map((tip) => (
            <TipRow key={tip.id} tip={tip} loggedIn={loggedIn} returnTo={returnTo} />
          ))}
        </ul>
      ) : (
        <p className="py-10 text-[15px] text-[#8A8D96]">Ainda não há dicas da comunidade neste guia.</p>
      )}
    </section>
  );
}
