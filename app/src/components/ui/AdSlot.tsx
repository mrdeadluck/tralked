/*
 * Advertising space of the editorial pages. It only reserves the area (so the page never jumps
 * when an ad arrives) and labels it "Publicidade". No third-party script is loaded here: a future
 * ad provider renders inside this box, and only after the visitor accepts optional cookies.
 */

export const AD_FORMATS = {
  /** 728×90 on wide screens, 320×100 on phones. */
  leaderboard: "h-[100px] max-w-[728px] min-[760px]:h-[90px]",
  /** 300×250. */
  retangulo: "h-[250px] max-w-[300px]",
} as const;

export type AdFormat = keyof typeof AD_FORMATS;

export function AdSlot({ format = "leaderboard", className = "" }: { format?: AdFormat; className?: string }) {
  return (
    <aside aria-label="Publicidade" data-ad-slot={format} className={`flex w-full flex-col gap-1.5 ${className}`}>
      <span className="font-mono text-xs tracking-[0.12em] text-dim uppercase">Publicidade</span>
      <div aria-hidden="true" className={`w-full rounded-[2px] border border-line bg-surface ${AD_FORMATS[format]}`} />
    </aside>
  );
}
