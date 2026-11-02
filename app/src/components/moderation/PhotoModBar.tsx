"use client";

import { useRouter } from "next/navigation";
import { moderateAction } from "@/app/admin/moderacao/actions";
import { ConfirmWithReason } from "./ConfirmWithReason";

/**
 * Moderation of a gallery photo from its page (moderators only). Hiding is reversible in
 * /admin/moderacao; removing is final and voids the photo's XP. The owner is told either way.
 */
export function PhotoModBar({ photoId }: { photoId: string }) {
  const router = useRouter();
  const run = (action: "hide" | "remove") => async (reason: string) => {
    const result = await moderateAction({ targetType: "photo", targetId: photoId, action, reason });
    if (!result.ok) return result.error;
    // The photo has no public page any more.
    router.push("/galeria");
    return null;
  };

  return (
    <section
      aria-label="Moderação da foto"
      className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-[4px] border border-dashed border-line-2 px-4 py-3"
    >
      <span className="pt-2.5 font-mono text-xs tracking-[0.12em] text-acc uppercase">Moderação</span>
      <ConfirmWithReason
        variant="button"
        label="Ocultar"
        ariaLabel="Ocultar esta foto"
        prompt="Ocultar esta foto? Dá para restaurar em Moderação. O autor é avisado."
        confirmLabel="Sim, ocultar"
        onConfirm={run("hide")}
      />
      <ConfirmWithReason
        variant="button"
        label="Remover"
        ariaLabel="Remover esta foto"
        prompt="Remover de vez? A imagem é apagada, o XP dela é anulado e o autor é avisado."
        confirmLabel="Sim, remover"
        onConfirm={run("remove")}
      />
    </section>
  );
}
