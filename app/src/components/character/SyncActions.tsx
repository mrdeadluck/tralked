"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { syncNow } from "@/app/jogador/[handle]/actions";
import { LevelUpOverlay } from "@/components/fx/LevelUpOverlay";
import { Toasts, useToasts } from "@/components/fx/Toasts";
import { useSound } from "@/components/fx/useSound";
import { Button } from "@/components/ui/Button";
import { SKILLS } from "@/lib/engine/types";
import { SkillIcon } from "./SkillIcon";

type SyncActionsProps = {
  /** "há 2 h", já formatado no servidor; null se nunca sincronizou. */
  lastSyncedLabel: string | null;
};

const SKILL_NAME = new Map<string, string>(SKILLS.map((s) => [s.id, s.name]));

/** Ações do dono: sincronizar conquistas (dispara level up e toasts) e ligar/desligar o som. */
export function SyncActions({ lastSyncedLabel }: SyncActionsProps) {
  const router = useRouter();
  const sound = useSound();
  const { toasts, push } = useToasts();
  const [syncing, startSync] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ from: number; to: number } | null>(null);
  const closeLevelUp = useCallback(() => setLevelUp(null), []);

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

      if (result.levelAfter > result.levelBefore) {
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
          aria-label={sound.muted ? "Ligar som" : "Desligar som"}
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

      <Toasts toasts={toasts} />
      {levelUp ? (
        <LevelUpOverlay from={levelUp.from} to={levelUp.to} onClose={closeLevelUp} />
      ) : null}
    </div>
  );
}
