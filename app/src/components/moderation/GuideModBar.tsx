"use client";

import { useRouter } from "next/navigation";
import { removeGuideAction } from "@/lib/moderation/actions";
import { ConfirmWithReason } from "./ConfirmWithReason";

/** Moderation bar on the guide page (moderators only): take the guide off the site. */
export function GuideModBar({ guideId, gameName }: { guideId: string; gameName: string }) {
  const router = useRouter();
  return (
    <section
      aria-label="Moderação do guia"
      className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-[4px] border border-dashed border-line-2 bg-surface px-4 py-3"
    >
      <span className="pt-2.5 font-mono text-xs tracking-[0.12em] text-acc uppercase">Moderação</span>
      <ConfirmWithReason
        variant="button"
        label="Tirar do ar"
        ariaLabel={`Tirar do ar o guia de ${gameName}`}
        prompt="Tirar este guia do ar? Ele volta para rascunho e o autor é avisado."
        confirmLabel="Sim, tirar do ar"
        onConfirm={async (reason) => {
          const result = await removeGuideAction({ id: guideId, reason });
          if (!result.ok) return result.error;
          router.refresh();
          return null;
        }}
      />
    </section>
  );
}
