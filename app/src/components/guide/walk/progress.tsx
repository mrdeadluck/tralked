"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  checkGameAchievements,
  resetGuideProgress,
  type CheckGameAchievementsResult,
  type ResetGuideProgressResult,
} from "@/app/jogos/[slug]/guia/actions";
import { announceReward, announceToast } from "@/components/fx/reward-bus";

/*
 * The visitor's progress on a walkthrough page. The page itself is the public, cached guide; only
 * this small state is per visitor: it starts anonymous and WalkUserSeed (streamed in by
 * WalkUserIsland once the session is read) fills it with the visitor's ticks and Steam unlocks.
 * Item rows, the journey, the slim bar, the ring and the sidebar all read it.
 *
 * An item is done when the visitor ticked it, has its Steam achievement, or has every achievement
 * it counts toward (countsFor: an herb of a quest whose achievement is unlocked was picked up):
 * `isDone` and `doneCount` say so everywhere, so a synced achievement counts like a tick in every
 * count.
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

/**
 * Who is reading: "pending" until the session is read (the island streams in), then "anon" or
 * "user". The cached page is the same for everyone: only this tells a member's skeleton from an
 * anonymous visitor's invitation.
 */
export type WalkSession = "pending" | "anon" | "user";

type WalkProgress = {
  guideId: string;
  gameId: string;
  /** The guide page, to come back after logging in. */
  returnTo: string;
  /** Staff preview of a guide still in review: ticking waits for the publication. */
  preview: boolean;
  /** Null for an anonymous visitor (and until the session streams in). */
  user: { unlockedCount: number | null; pendingXp: number } | null;
  session: WalkSession;
  /** Ticked by the visitor (what toggleItem stores). */
  isTicked: (ref: string) => boolean;
  /** How many items the visitor ticked by hand. */
  tickedCount: number;
  /** Clears every tick of the visitor on this guide (resetGuideProgress); Steam unlocks stay. */
  resetTicks: () => Promise<ResetGuideProgressResult>;
  /** Ticked, or confirmed by Steam (isConfirmed). */
  isDone: (ref: string) => boolean;
  /** Its own Steam achievement unlocked, or every achievement it counts toward. */
  isConfirmed: (ref: string) => boolean;
  doneCount: (refs: readonly string[]) => number;
  setDone: (ref: string, done: boolean) => void;
  isUnlocked: (achievementId: string) => boolean;
  /** Database id of the Steam achievement an item is (null: not an achievement). */
  achievementOf: (ref: string) => string | null;
  /** Database ids of the achievements an item counts toward (empty: none). */
  countsForOf: (ref: string) => readonly string[];
  /**
   * Asks Steam for this game's achievements (checkGameAchievements). New unlocks are marked on the
   * page and announced ("TRALKED!" and the XP Steam's confirmation paid).
   */
  check: () => Promise<CheckGameAchievementsResult>;
};

const WalkProgressContext = createContext<WalkProgress | null>(null);

type Seed = { seed: (seed: WalkUserSeedData) => void; anonymous: () => void };
const SeedContext = createContext<Seed>({ seed: () => {}, anonymous: () => {} });

type ProviderProps = {
  guideId: string;
  gameId: string;
  returnTo: string;
  preview?: boolean;
  /** Item ref → database id of the Steam achievement the item is. */
  achievements?: Record<string, string>;
  /** Item ref → database ids of the achievements it counts toward (items toward none left out). */
  countsFor?: Record<string, string[]>;
  children: ReactNode;
};

const NO_ACHIEVEMENTS: Record<string, string> = {};
const NO_COUNTS: Record<string, string[]> = {};
const TOWARD_NONE: readonly string[] = [];

export function WalkProgressProvider({
  guideId,
  gameId,
  returnTo,
  preview = false,
  achievements = NO_ACHIEVEMENTS,
  countsFor = NO_COUNTS,
  children,
}: ProviderProps) {
  const [user, setUser] = useState<WalkProgress["user"]>(null);
  const [session, setSession] = useState<WalkSession>("pending");
  const [done, setDoneSet] = useState<ReadonlySet<string>>(() => new Set());
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => new Set());

  const seeds = useMemo<Seed>(
    () => ({
      seed: (s) => {
        setUser({ unlockedCount: s.unlockedCount, pendingXp: s.pendingXp });
        setSession("user");
        setDoneSet(new Set(s.doneRefs));
        setUnlocked(new Set(s.unlockedIds));
      },
      anonymous: () => setSession((s) => (s === "pending" ? "anon" : s)),
    }),
    [],
  );

  const setDone = useCallback((ref: string, value: boolean) => {
    setDoneSet((prev) => {
      const next = new Set(prev);
      if (value) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }, []);

  const check = useCallback(
    async () => {
      const result = await checkGameAchievements(gameId);
      if (result.status === "ok" && result.newUnlocks.length > 0) {
        const ids = result.newUnlocks.map((u) => u.id);
        setUnlocked((prev) => new Set([...prev, ...ids]));
        setUser((u) => (u && u.unlockedCount !== null ? { ...u, unlockedCount: u.unlockedCount + ids.length } : u));
        if (result.reward) announceReward({ ...result.reward, reason: "TRALKED!" });
        else announceToast({ title: "TRALKED!", text: result.newUnlocks.map((u) => u.name).join(", "), icon: "trophy" });
      }
      return result;
    },
    [gameId],
  );

  const resetTicks = useCallback(async () => {
    const result = await resetGuideProgress(guideId);
    if (result.status === "ok") setDoneSet(new Set());
    return result;
  }, [guideId]);

  const achievementOf = useCallback((ref: string) => achievements[ref] ?? null, [achievements]);
  const countsForOf = useCallback((ref: string) => countsFor[ref] ?? TOWARD_NONE, [countsFor]);

  const value = useMemo<WalkProgress>(() => {
    const isConfirmed = (ref: string) => {
      const id = achievements[ref];
      if (id !== undefined && unlocked.has(id)) return true;
      const toward = countsFor[ref];
      return toward !== undefined && toward.length > 0 && toward.every((a) => unlocked.has(a));
    };
    const isDone = (ref: string) => done.has(ref) || isConfirmed(ref);
    return {
      guideId,
      gameId,
      returnTo,
      preview,
      user,
      session,
      isTicked: (ref) => done.has(ref),
      tickedCount: done.size,
      resetTicks,
      isDone,
      isConfirmed,
      doneCount: (refs) => refs.reduce((n, ref) => n + (isDone(ref) ? 1 : 0), 0),
      setDone,
      isUnlocked: (id) => unlocked.has(id),
      achievementOf,
      countsForOf,
      check,
    };
  }, [
    guideId,
    gameId,
    returnTo,
    preview,
    user,
    session,
    done,
    setDone,
    resetTicks,
    unlocked,
    achievements,
    countsFor,
    achievementOf,
    countsForOf,
    check,
  ]);
  return (
    <SeedContext.Provider value={seeds}>
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
  const { seed } = useContext(SeedContext);
  const { doneRefs, unlockedIds, unlockedCount, pendingXp } = props;
  useEffect(() => {
    seed({ doneRefs, unlockedIds, unlockedCount, pendingXp });
    // Arrays arrive once per render of the island: compare their content, not their identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, doneRefs.join("|"), unlockedIds.join("|"), unlockedCount, pendingXp]);
  return null;
}

/** Tells the page nobody is signed in (rendered by WalkUserIsland instead of the seed). */
export function WalkUserAnon() {
  const { anonymous } = useContext(SeedContext);
  useEffect(() => anonymous(), [anonymous]);
  return null;
}
