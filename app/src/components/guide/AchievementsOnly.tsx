"use client";

import { useState, type CSSProperties } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import type { AchievementsOnlyItem, AchievementsOnlyPlatform } from "@/lib/queries/achievements-only";
import { pctText } from "./format";

const LABEL: Record<AchievementsOnlyPlatform, string> = {
  steam: "Steam",
  psn: "PSN",
  xbox: "Xbox",
  retro: "RetroAchievements",
};

// Tralked graphite + lime; PSN keeps its existing blue. No new accent.
const COLOR: Record<AchievementsOnlyPlatform, string> = {
  steam: "var(--acc)",
  psn: "var(--ps)",
  xbox: "var(--acc)",
  retro: "var(--acc)",
};

function Row({ a, platform }: { a: AchievementsOnlyItem; platform: AchievementsOnlyPlatform }) {
  const [revealed, setRevealed] = useState(false);
  const blurred = a.hidden && !revealed;

  return (
    <li
      data-hidden={blurred ? "true" : "false"}
      style={{ "--rc": COLOR[platform] } as CSSProperties}
      className="relative grid grid-cols-[52px_minmax(0,1fr)_auto] gap-x-[18px] gap-y-1 border-b border-line py-5 max-[640px]:grid-cols-[44px_minmax(0,1fr)]"
    >
      <div className="tk-cut-b col-start-1 row-span-2 row-start-1 grid size-[52px] place-items-center overflow-hidden border-2 border-(--rc) bg-surface">
        {a.iconUrl && !blurred ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.iconUrl} alt="" width={48} height={48} loading="lazy" className="size-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--rc)" strokeWidth="1.8" aria-hidden="true" className="size-6">
            <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 21h8M10 17h4" />
          </svg>
        )}
      </div>
      <div
        className={`col-start-2 row-span-2 row-start-1 flex min-w-0 flex-col gap-1 ${blurred ? "blur-[6px] select-none" : ""}`}
      >
        <h3 className="text-[19px] font-extrabold font-stretch-[105%] tracking-[-0.015em]">{a.name}</h3>
        {a.description ? <p className="text-[15.5px] text-muted">{a.description}</p> : null}
      </div>
      <small className="col-start-3 row-start-1 text-right font-mono text-xs text-dim max-[640px]:col-start-2 max-[640px]:row-start-3 max-[640px]:text-left">
        {pctText(a.globalPct)} dos jogadores
      </small>
      {blurred ? (
        <button
          type="button"
          aria-label="Conquista oculta: mostrar"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 grid cursor-pointer place-items-center"
        >
          <span className="tk-cut-sm bg-bg px-3 py-1 font-mono text-xs tracking-[0.1em] text-acc uppercase shadow-[inset_0_0_0_1px_var(--border)]">
            Oculta · mostrar
          </span>
        </button>
      ) : null}
    </li>
  );
}

type AchievementsOnlyProps = {
  lists: { platform: AchievementsOnlyPlatform; achievements: AchievementsOnlyItem[] }[];
};

export function AchievementsOnly({ lists }: AchievementsOnlyProps) {
  const [active, setActive] = useState<AchievementsOnlyPlatform>(lists[0]?.platform ?? "steam");
  const current = lists.find((l) => l.platform === active) ?? lists[0];

  return (
    <section id="g-conq" className="mt-10 scroll-mt-24">
      <div className="tk-cut border border-line bg-surface px-5 py-4 text-[15.5px] text-text-2">
        <b className="text-text">Este jogo ainda não tem Guia Tralked.</b> Enquanto isso, aqui estão as conquistas
        que já sincronizamos.
      </div>
      <div className="mt-10">
        <SectionHead title="Conquistas" />
      </div>
      {lists.length > 1 ? (
        <div role="group" aria-label="Plataforma" className="inline-flex flex-wrap gap-0.5 pt-4 pb-1.5">
          {lists.map((l) => (
            <button
              key={l.platform}
              type="button"
              aria-pressed={l.platform === active}
              onClick={() => setActive(l.platform)}
              className={`inline-flex h-11 cursor-pointer items-center px-3 text-[12.5px] font-bold font-stretch-[80%] tracking-[0.06em] uppercase sm:h-9 ${
                l.platform === active
                  ? "bg-acc text-bg"
                  : "text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-text"
              }`}
            >
              {LABEL[l.platform]} · {l.achievements.length}
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <ul className="m-0 list-none p-0">
          {current.achievements.map((a, i) => (
            <Row key={`${current.platform}-${i}`} a={a} platform={current.platform} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
