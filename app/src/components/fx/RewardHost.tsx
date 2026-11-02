"use client";

import { useCallback, useEffect, useState } from "react";
import type { LevelChange } from "@/lib/progression/reward";
import { LevelUpOverlay } from "./LevelUpOverlay";
import { REWARD_EVENT, type RewardEventDetail } from "./reward-bus";
import { Toasts, useToasts } from "./Toasts";

/** The XP toast lands first; the level up follows once it has been read. */
const LEVEL_UP_DELAY_MS = 700;

/**
 * The one reward host of the site (mounted in the root layout): XP toasts and the level-up
 * overlay for every action that announces through `reward-bus`. Renders nothing until something
 * happens, and nothing at all without JS.
 */
export function RewardHost() {
  const { toasts, push, dismiss } = useToasts();
  const [levelUp, setLevelUp] = useState<LevelChange | null>(null);
  const close = useCallback(() => setLevelUp(null), []);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function onReward(event: Event) {
      const detail = (event as CustomEvent<RewardEventDetail>).detail;
      if (detail.toast) push(detail.toast);
      const change = detail.levelUp;
      if (change) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          // Two rises before the first is closed become one: from the lowest to the highest.
          setLevelUp((open) =>
            open ? { from: Math.min(open.from, change.from), to: Math.max(open.to, change.to) } : change,
          );
        }, LEVEL_UP_DELAY_MS);
        timers.add(timer);
      }
    }
    window.addEventListener(REWARD_EVENT, onReward);
    return () => {
      window.removeEventListener(REWARD_EVENT, onReward);
      timers.forEach(clearTimeout);
    };
  }, [push]);

  return (
    <>
      <Toasts toasts={toasts} onDismiss={dismiss} />
      {levelUp ? <LevelUpOverlay from={levelUp.from} to={levelUp.to} onClose={close} /> : null}
    </>
  );
}
