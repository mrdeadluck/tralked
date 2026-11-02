import type { LevelChange, Reward } from "@/lib/progression/reward";
import type { ToastInput } from "./Toasts";

/**
 * Tiny window event bus between any client component that just ran an action and the one
 * RewardHost mounted in the root layout. Decoupled on purpose: a like button, the photo upload and
 * the sync button only announce; the host decides how it looks.
 */
export const REWARD_EVENT = "tralked:reward";

export type RewardEventDetail = { toast?: ToastInput; levelUp?: LevelChange };

function emit(detail: RewardEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RewardEventDetail>(REWARD_EVENT, { detail }));
}

/** Icon of each reward reason (a SkillIcon name); the skill wins when there is one. */
const REASON_ICON: Record<string, string> = {
  Curtida: "like",
  Reação: "like",
  "Foto publicada": "photo",
  Sincronização: "sync",
  Missão: "mission",
};

/** Any plain toast ("3 novas conquistas · Sincronização concluída"). */
export function announceToast(toast: ToastInput) {
  emit({ toast });
}

export function announceLevelUp(levelUp: LevelChange) {
  emit({ levelUp });
}

/** "+5 XP · Curtida" (merging with the toast already on screen), and the level up if any. */
export function announceReward(reward: Reward | null | undefined) {
  if (!reward) return;
  if (reward.xpGained > 0) {
    emit({
      toast: {
        xp: reward.xpGained,
        title: reward.reason,
        icon: reward.skill ?? REASON_ICON[reward.reason] ?? "level",
        key: `xp:${reward.reason}`,
      },
    });
  }
  if (reward.levelUp) emit({ levelUp: reward.levelUp });
}
