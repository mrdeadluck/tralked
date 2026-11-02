import type { CSSProperties } from "react";
import { SkillIcon } from "@/components/character/SkillIcon";

/** Icon and color of each notification kind (Notification.kind), for the bell and /notificacoes. */
const KIND_LOOK: Record<string, { icon: string; color: string; label: string }> = {
  level_up: { icon: "level", color: "var(--acc)", label: "Nível" },
  skill_up: { icon: "level", color: "var(--acc)", label: "Habilidade" },
  attribute_up: { icon: "level", color: "var(--acc)", label: "Atributo" },
  mission_done: { icon: "mission", color: "var(--acc)", label: "Missão" },
  streak_risk: { icon: "streak", color: "var(--pc)", label: "Sequência" },
  rank_passed: { icon: "rank", color: "var(--nin)", label: "Ranking" },
  like: { icon: "like", color: "var(--ps)", label: "Curtida" },
  photo_like: { icon: "like", color: "var(--ps)", label: "Curtida" },
  comment_reply: { icon: "comment", color: "var(--text-3)", label: "Resposta" },
  forum_reply: { icon: "comment", color: "var(--text-3)", label: "Resposta" },
  thread_solved: { icon: "sabio", color: "var(--acc)", label: "Fórum" },
  content_published: { icon: "trophy", color: "var(--text-3)", label: "Publicação" },
};
const FALLBACK = { icon: "info", color: "var(--dim)", label: "Aviso" };

export function kindLook(kind: string) {
  return KIND_LOOK[kind] ?? FALLBACK;
}

/** Small square tile with the kind's icon (decorative: the title says what happened). */
export function NotificationKindIcon({ kind, size = 32, dim = false }: { kind: string; size?: number; dim?: boolean }) {
  const look = kindLook(kind);
  return (
    <span
      aria-hidden="true"
      style={{ "--c": look.color, width: size, height: size } as CSSProperties}
      className={`grid flex-none place-items-center rounded-[2px] text-(--c) ${
        dim ? "bg-hover opacity-70" : "bg-[color-mix(in_srgb,var(--c)_14%,transparent)]"
      }`}
    >
      <SkillIcon name={look.icon} width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </span>
  );
}
