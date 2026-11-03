"use client";

import { loginHref } from "@/components/guide/format";
import { Ring } from "@/components/ui/Ring";
import { formatCompact } from "@/lib/xp-format";
import { useWalkProgress } from "./progress";

/*
 * The small parts of a walkthrough page that show the visitor's own progress: the ring of the hero,
 * the "Seu progresso" card and the per-chapter tick counter. Anonymous until the session streams in.
 */

/** Ring of the hero: Steam achievements the visitor has of the game's total. */
export function ProgressRing({ achievementCount }: { achievementCount: number }) {
  const { user } = useWalkProgress();
  const count = user?.unlockedCount;
  if (count == null || achievementCount <= 0) return null;
  return (
    <div className="wk-ring">
      <Ring value={Math.round((count / achievementCount) * 100)} size={104} />
      <small>
        {count} de {achievementCount}
      </small>
    </div>
  );
}

type ProgressCardProps = { achievementCount: number; collectibleRefs: string[] };

/** "Seu progresso": Steam achievements, ticked collectibles and the XP still on the table. */
export function ProgressCard({ achievementCount, collectibleRefs }: ProgressCardProps) {
  const { user, doneCount, returnTo } = useWalkProgress();
  return (
    <div className="wk-card">
      <h2>Seu progresso</h2>
      {user ? (
        <>
          <p className="wk-row">
            <span>Conquistas</span>
            <b>
              {user.unlockedCount ?? 0} / {achievementCount}
            </b>
          </p>
          <p className="wk-row">
            <span>Coletáveis</span>
            <b>
              {doneCount(collectibleRefs)} / {collectibleRefs.length}
            </b>
          </p>
          <p className="wk-row">
            <span>Faltam neste guia</span>
            <b className="acc">+{formatCompact(user.pendingXp)} XP</b>
          </p>
          <p className="note">
            {user.unlockedCount !== null
              ? "As conquistas vêm da sua Steam. O XP só entra quando a Steam confirma."
              : "Este jogo ainda não aparece na sua biblioteca Steam. Sincronize seu perfil para acompanhar."}
          </p>
        </>
      ) : (
        <p className="note">
          <a href={loginHref(returnTo)}>Entre</a> para marcar os itens do detonado e ver quanto XP as{" "}
          {achievementCount} conquistas valem para você.
        </p>
      )}
    </div>
  );
}

/** "3 / 61": ticked items of a chapter. */
export function DoneCount({ refs }: { refs: string[] }) {
  const { doneCount } = useWalkProgress();
  return (
    <b>
      {doneCount(refs)} / {refs.length}
    </b>
  );
}
