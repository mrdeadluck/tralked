"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { checkGameAchievements, type CheckGameAchievementsResult } from "@/app/jogos/[slug]/guia/actions";
import { announceReward, announceToast } from "@/components/fx/reward-bus";

/*
 * The visitor's progress on a walkthrough page. The page itself is the public, cached guide; only
 * this small state is per visitor: it starts anonymous and WalkUserSeed (streamed in by
 * WalkUserIsland once the session is read) fills it with the visitor's ticks and Steam unlocks.
 * Item rows, the journey, the slim bar, the ring and the sidebar all read it.
 */

/** What the server knows about the signed-in visitor. Item refs, never raw keys of gated items. */
export type WalkUserSeedData = {
  doneRefs: string[];
  /** Database ids of the guide's Steam achievements the visitor has. */
  unlockedIds: string[];
  /** Steam achievements of the game the visitor has; null when the game is not in their library. */
  unlockedCount: number | null;
  /** XP of the guide's achievements still to unlock. */
  pendingXp: number;
};

type WalkProgress = {
  guideId: string;
  gameId: string;
  /** The guide page, to come back after logging in. */
  returnTo: string;
  /** Staff preview of a guide still in review: ticking waits for the publication. */
  preview: boolean;
  /** Null for an anonymous visitor (and until the session streams in). */
  user: { unlockedCount: number | null; pendingXp: number } | null;
  isDone: (ref: string) => boolean;
  doneCount: (refs: readonly string[]) => number;
  setDone: (ref: string, done: boolean) => void;
  isUnlocked: (achievementId: string) => boolean;
  /**
   * Asks Steam for this game's achievements (checkGameAchievements). New unlocks are marked on the
   * page and announced ("TRALKED!" and the XP Steam's confirmation paid).
   */
  check: () => Promise<CheckGameAchievementsResult>;
};

const WalkProgressContext = createContext<WalkProgress | null>(null);
const SeedContext = createContext<(seed: WalkUserSeedData) => void>(() => {});

type ProviderProps = { guideId: string; gameId: string; returnTo: string; preview?: boolean; children: ReactNode };

export function WalkProgressProvider({ guideId, gameId, returnTo, preview = false, children }: ProviderProps) {
  const [user, setUser] = useState<WalkProgress["user"]>(null);
  const [done, setDoneSet] = useState<ReadonlySet<string>>(() => new Set());
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => new Set());

  const seed = useCallback((s: WalkUserSeedData) => {
    setUser({ unlockedCount: s.unlockedCount, pendingXp: s.pendingXp });
    setDoneSet(new Set(s.doneRefs));
    setUnlocked(new Set(s.unlockedIds));
  }, []);

  const setDone = useCallback((ref: string, value: boolean) => {
    setDoneSet((prev) => {
      const next = new Set(prev);
      if (value) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }, []);

  const check = useCallback(async () => {
    const result = await checkGameAchievements(gameId);
    if (result.status === "ok" && result.newUnlocks.length > 0) {
      const ids = result.newUnlocks.map((u) => u.id);
      setUnlocked((prev) => new Set([...prev, ...ids]));
      setUser((u) => (u && u.unlockedCount !== null ? { ...u, unlockedCount: u.unlockedCount + ids.length } : u));
      if (result.reward) announceReward({ ...result.reward, reason: "TRALKED!" });
      else announceToast({ title: "TRALKED!", text: result.newUnlocks.map((u) => u.name).join(", "), icon: "trophy" });
    }
    return result;
  }, [gameId]);

  const value = useMemo<WalkProgress>(
    () => ({
      guideId,
      gameId,
      returnTo,
      preview,
      user,
      isDone: (ref) => done.has(ref),
      doneCount: (refs) => refs.reduce((n, ref) => n + (done.has(ref) ? 1 : 0), 0),
      setDone,
      isUnlocked: (id) => unlocked.has(id),
      check,
    }),
    [guideId, gameId, returnTo, preview, user, done, setDone, unlocked, check],
  );
  return (
    <SeedContext.Provider value={seed}>
      <WalkProgressContext.Provider value={value}>{children}</WalkProgressContext.Provider>
    </SeedContext.Provider>
  );
}

/** The page's progress state. Outside a provider: an anonymous page that cannot tick anything. */
export function useWalkProgress(): WalkProgress {
  const ctx = useContext(WalkProgressContext);
  if (!ctx) throw new Error("useWalkProgress outside WalkProgressProvider");
  return ctx;
}

/** Hands the signed-in visitor's progress to the page (rendered by WalkUserIsland). */
export function WalkUserSeed(props: WalkUserSeedData) {
  const seed = useContext(SeedContext);
  const { doneRefs, unlockedIds, unlockedCount, pendingXp } = props;
  useEffect(() => {
    seed({ doneRefs, unlockedIds, unlockedCount, pendingXp });
    // Arrays arrive once per render of the island: compare their content, not their identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, doneRefs.join("|"), unlockedIds.join("|"), unlockedCount, pendingXp]);
  return null;
}
