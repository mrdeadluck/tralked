"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { markDespertarShownAction, syncNow } from "@/app/jogador/[handle]/actions";
import { LevelUpOverlay } from "@/components/fx/LevelUpOverlay";
import { announceReward, announceToast } from "@/components/fx/reward-bus";
import { useSound } from "@/components/fx/useSound";
import { Button } from "@/components/ui/Button";
import { SKILLS } from "@/lib/engine/types";
import { DespertarOverlay } from "./DespertarOverlay";
import { SkillIcon } from "./SkillIcon";

type SyncActionsProps = {
  /** "há 2 h", já formatado no servidor; null se nunca sincronizou. */
  lastSyncedLabel: string | null;
  /** Níveis do "Despertar" ainda não mostrado (já sincronizou ao menos uma vez); senão null. */
  despertarSteps?: number[] | null;
};

const SKILL_NAME = new Map<string, string>(SKILLS.map((s) => [s.id, s.name]));

const noopSubscribe = () => () => {};

/** Ações do dono: sincronizar conquistas (dispara level up e toasts) e ligar/desligar o som. */
export function SyncActions({ lastSyncedLabel, despertarSteps = null }: SyncActionsProps) {
  const router = useRouter();
  const sound = useSound();
  // Toasts go to the site-wide RewardHost (root layout): one stack for every reward.
  const push = announceToast;
  const [syncing, startSync] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ from: number; to: number } | null>(null);
  const closeLevelUp = useCallback(() => setLevelUp(null), []);
  // The Despertar plays once: from the page (history already imported) or after the first sync.
  const [despertar, setDespertar] = useState<number[] | null>(despertarSteps);
  const closeDespertar = useCallback(() => setDespertar(null), []);
  // Overlays only after hydration: without JS the modal could never be closed.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    // Marked as soon as it starts playing, so leaving the page midway does not replay it.
    if (despertarSteps) void markDespertarShownAction();
    // Only the steps the page was first rendered with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSync() {
    sound.unlock(); // libera o áudio dentro do gesto do usuário
    setError(null);
    startSync(async () => {
      const result = await syncNow();
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (result.newUnlocks > 0) {
        push({
          title: `${result.newUnlocks} ${result.newUnlocks === 1 ? "nova conquista" : "novas conquistas"}`,
          text: "Sincronização concluída",
          icon: "trophy",
        });
        sound.play([660, 990], 0.09);
      } else {
        push({ title: "Tudo em dia", text: "Nenhuma conquista nova", icon: "trophy" });
      }
      // The level up has its own overlay here (with the Despertar), so the reward is XP only.
      // Mission rewards get their own toast below, so they are taken out of the sync's total.
      const missionXp = result.missionsDone.reduce((sum, m) => sum + m.rewardXp, 0);
      const syncXp = result.xpGained - missionXp;
      announceReward(syncXp > 0 ? { xpGained: syncXp, reason: "Sincronização" } : null);
      result.missionsDone.forEach((mission, index) => {
        setTimeout(() => {
          push({ title: "Missão concluída", text: mission.title, icon: "mission", key: `mission:${mission.title}` });
          announceReward({ xpGained: mission.rewardXp, reason: "Missão" });
        }, 300 + index * 350);
      });

      result.skillUps.forEach((id, index) => {
        setTimeout(() => {
          push({
            title: `Você avançou em ${SKILL_NAME.get(id) ?? id}`,
            text: "Skill subiu de nível",
            color: "var(--text)",
            icon: id,
          });
          sound.play([523, 784], 0.1, "square");
        }, 500 + index * 400);
      });

      if (result.despertarSteps) {
        // First import: the whole climb from level 1 replaces the single level up.
        setDespertar(result.despertarSteps);
        await markDespertarShownAction();
      } else if (result.levelAfter > result.levelBefore) {
        setLevelUp({ from: result.levelBefore, to: result.levelAfter });
        sound.play([523, 659, 784, 1047, 1319], 0.11);
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={handleSync} disabled={syncing}>
          <SkillIcon name="trophy" className="size-4" />
          {syncing ? "Sincronizando..." : "Sincronizar conquistas"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            sound.unlock();
            sound.toggleMuted();
          }}
          aria-pressed={!sound.muted}
        >
          Som: {sound.muted ? "desligado" : "ligado"}
        </Button>
      </div>
      <p aria-live="polite" className="font-mono text-xs text-dim">
        {error ? (
          <span role="alert" className="text-nin">
            {error}
          </span>
        ) : lastSyncedLabel ? (
          `Última sincronização: ${lastSyncedLabel}`
        ) : (
          "Ainda não sincronizado."
        )}
      </p>

      {hydrated && despertar ? (
        <DespertarOverlay
          steps={despertar}
          onClose={closeDespertar}
          onStep={(level) => sound.play([392 + Math.min(level, 60) * 12], 0.08, "square")}
        />
      ) : hydrated && levelUp ? (
        <LevelUpOverlay from={levelUp.from} to={levelUp.to} onClose={closeLevelUp} />
      ) : null}
    </div>
  );
}
