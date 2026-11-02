"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import type { GuideAchievementView } from "@/lib/queries/games";
import { CATEGORY_NAME, fmt, pctText, RARITY_UI } from "./format";
import { RichText } from "./RichText";

/** Blurred until clicked (or Enter/Space), unless `hidden` is false (spoilers shown or not a spoiler). */
function Spoiler({
  hidden,
  className = "",
  children,
}: {
  hidden: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const blurred = hidden && !revealed;

  if (!blurred) return <div className={className}>{children}</div>;

  // The blurred copy is decoration; a real button on top owns the name and the keyboard.
  return (
    <div className={`relative ${className}`}>
      <div aria-hidden="true" className="blur-[6px] select-none">
        {children}
      </div>
      <button
        type="button"
        title="Spoiler: clique para revelar"
        aria-label="Spoiler escondido. Pressione Enter para revelar."
        onClick={() => setRevealed(true)}
        className="absolute inset-0 cursor-pointer"
      />
    </div>
  );
}

const TROPHY = (
  <>
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 21h8M10 17h4" />
  </>
);
const LOCK = (
  <>
    <rect x="5" y="11" width="14" height="10" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
);

type AchievementItemProps = {
  achievement: GuideAchievementView;
  showSpoilers: boolean;
};

export function AchievementItem({ achievement: a, showSpoilers }: AchievementItemProps) {
  const rarity = RARITY_UI[a.tier];
  const hide = a.spoiler && !showSpoilers;

  return (
    <li
      style={{ "--rc": rarity.color } as CSSProperties}
      className="grid grid-cols-[52px_minmax(0,1fr)_auto] gap-x-[18px] gap-y-1 border-b border-line py-5 max-[640px]:grid-cols-[44px_minmax(0,1fr)]"
    >
      <div
        className={`row-span-3 grid size-[52px] place-items-center border-2 border-(--rc) bg-[color-mix(in_srgb,var(--rc)_12%,var(--bg))] text-(--rc) [clip-path:polygon(0_0,100%_0,100%_76%,76%_100%,0_100%)] max-[640px]:row-span-2 max-[640px]:size-11 ${
          a.done ? "" : "[filter:saturate(.3)_brightness(.75)]"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden="true"
          className="size-6"
        >
          {a.done ? TROPHY : LOCK}
        </svg>
      </div>

      <h3 className="flex flex-wrap items-center gap-2.5 text-[19px] font-extrabold font-stretch-[105%] tracking-[-0.015em]">
        {a.name}
        <span className="border border-[color-mix(in_srgb,var(--rc)_50%,transparent)] px-1.5 py-px font-mono text-xs font-medium tracking-[0.1em] text-(--rc) uppercase">
          {rarity.label}
        </span>
      </h3>

      <div className="row-span-3 flex flex-col items-end gap-1.5 text-right max-[640px]:col-start-2 max-[640px]:row-auto max-[640px]:flex-row max-[640px]:flex-wrap max-[640px]:items-center max-[640px]:text-left">
        <span className="font-mono text-[13px] font-bold text-acc">+{fmt(a.xp)} XP</span>
        <small className="font-mono text-xs text-dim">{pctText(a.globalPct)} dos jogadores</small>
        {a.done ? (
          <span className="font-mono text-xs tracking-[0.1em] text-acc uppercase">
            ✓ Desbloqueada
          </span>
        ) : null}
      </div>

      {a.description ? (
        <Spoiler hidden={hide} className="text-[15.5px] text-muted">
          <p>{a.description}</p>
        </Spoiler>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Chip plain>{CATEGORY_NAME[a.category] ?? a.category}</Chip>
        {a.spoiler ? <Chip color="var(--r-lendario)">Spoiler</Chip> : null}
      </div>

      <details className="group col-[2/-1] mt-2.5 max-[640px]:col-[1/-1]">
        <summary className="cursor-pointer list-none font-mono text-xs tracking-[0.08em] text-acc uppercase before:content-['+_'] group-open:before:content-['−_'] [&::-webkit-details-marker]:hidden">
          Como fazer
        </summary>
        <Spoiler
          hidden={hide}
          className="mt-3 flex flex-col gap-2.5 rounded-[2px] border border-line bg-surface px-[18px] py-4"
        >
          <RichText blocks={a.tipBlocks} text={a.tip} cards={a.cards} className="text-[15.5px] text-text-2" />
          {a.steps.length > 0 ? (
            <ol className="m-0 flex flex-col gap-1 pl-5 text-[15px] text-text-2">
              {a.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </Spoiler>
      </details>
    </li>
  );
}
