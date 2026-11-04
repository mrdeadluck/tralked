import type { ReactNode } from "react";
import type { ContentBlock } from "@/lib/content/schema";
import type { WalkItem, Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail } from "@/lib/queries/games";

/*
 * One guide, two versions: Steam (the master list) and PlayStation, for a guide written from the
 * Steam list whose PSN list is known (compat steam_only and the report's list sizes). PlayStation
 * leaves out what does not exist there: the Steam-only achievements' items, the items that only count
 * toward them, and the steps and chapters left with nothing of their own.
 *
 * The page is the same for everyone (cached): it marks at render time what the PlayStation version
 * leaves out (`wk-steam-only`) and draws both values of every number the versions count differently
 * (`Both`); the root's `data-versao` (version-state.tsx) picks one with CSS.
 */

export type Version = "steam" | "playstation";

/** URL parameter and value of the PlayStation version (`?versao=playstation`). */
export const VERSION_PARAM = "versao";

/** Only a format-2 guide from the Steam list (not scope psn), Steam only, with the PSN list's size. */
export function hasVersions(guide: Pick<GuideDetail, "compat" | "walkthrough" | "walk">): boolean {
  return (
    guide.compat === "steam_only" &&
    guide.walkthrough !== null &&
    guide.walkthrough.scope !== "psn" &&
    Boolean(guide.walk?.compatCounts)
  );
}

/** The version a visitor reads: the URL's, else the one stored in the browser, else Steam. */
export function chosenVersion(search: string, stored: string | null): Version {
  const asked = new URLSearchParams(search).get(VERSION_PARAM);
  if (asked === "steam" || asked === "playstation") return asked;
  return stored === "playstation" ? "playstation" : "steam";
}

/**
 * The Steam-only test of the walkthrough's items: an item whose achievement is not on the PSN list,
 * or one that only counts toward such achievements. An apiName no item is (unknown here) never
 * counts as Steam only.
 */
export function steamOnlyTest(walkthrough: Walkthrough): (item: WalkItem) => boolean {
  const items = walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const onPsn = new Set(items.flatMap((i) => (i.achievement && i.alsoOn.includes("psn") ? [i.achievement] : [])));
  const steamOnly = new Set(items.flatMap((i) => (i.achievement && !onPsn.has(i.achievement) ? [i.achievement] : [])));
  // By apiName: an achievement on the PSN list keeps every item that is it.
  return (item) =>
    item.achievement
      ? !onPsn.has(item.achievement)
      : item.countsFor.length > 0 && item.countsFor.every((apiName) => steamOnly.has(apiName));
}

/**
 * A block of the step's own text: a step holding one stays even when all its items go. Only a
 * warning (callout "aviso", about the items) and the blocks without text (image, video, divider,
 * achievement) are not.
 */
function ownText(block: ContentBlock): boolean {
  switch (block.type) {
    case "paragraph":
    case "list":
    case "quote":
    case "table":
    case "heading":
      return true;
    case "callout":
      return block.tone !== "aviso";
    default:
      return false;
  }
}

/** A step the PlayStation version leaves out: it had items, all Steam only, and no text of its own. */
export function steamOnlyStep(body: readonly ContentBlock[], items: readonly { steamOnly: boolean }[]): boolean {
  return items.length > 0 && items.every((i) => i.steamOnly) && !body.some(ownText);
}

/** Class of what the PlayStation version leaves out. */
export const STEAM_ONLY = "wk-steam-only";
/** Class of what only the PlayStation version shows. */
export const PS_ONLY = "wk-ps-only";

/** `base` plus the Steam-only class when `steamOnly`. */
export const withSteamOnly = (base: string, steamOnly: boolean) => (steamOnly ? `${base} ${STEAM_ONLY}` : base);

/**
 * What the two versions show differently (a count, a label): both are in the page and the root's
 * version shows one. The same value (or no PlayStation value) is drawn once.
 */
export function Both({ steam, ps }: { steam: ReactNode; ps?: ReactNode }) {
  if (ps === undefined || ps === steam) return <>{steam}</>;
  return (
    <>
      <span className={STEAM_ONLY}>{steam}</span>
      <span className={PS_ONLY}>{ps}</span>
    </>
  );
}

/**
 * The separator before entry `i` of a list of names, when the PlayStation version leaves some out:
 * none before the first entry either version shows.
 */
export function Separator({ items, index }: { items: readonly { steamOnly: boolean }[]; index: number }) {
  if (index === 0) return null;
  const shownBefore = items.slice(0, index).some((i) => !i.steamOnly);
  return shownBefore ? <>, </> : <span className={STEAM_ONLY}>, </span>;
}
