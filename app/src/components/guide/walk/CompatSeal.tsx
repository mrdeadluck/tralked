import type { GuideCompat } from "@/lib/content/walkthrough-schema";

/*
 * Platform seal of a walkthrough. The Steam list is the master list. When the PlayStation list
 * differs and the robot report has its size, the guide reads as Steam or PlayStation (versions.tsx):
 * "STEAM E PLAYSTATION" with both sizes (lime). Without that size: "APENAS STEAM" (amber). When the
 * lists match: which other lists it also covers (lime). A guide written from the PSN list (scope
 * psn, R22) shows PsnListSeal instead (PSN blue), with how many Steam achievements are left without a route.
 */

const COMPATIBLE: Record<Exclude<GuideCompat, "steam_only">, { title: string; note: string }> = {
  psn_xbox: { title: "COMPATÍVEL COM PSN E XBOX", note: "A mesma lista vale no PlayStation e no Xbox." },
  psn: { title: "COMPATÍVEL COM PSN", note: "A mesma lista vale no PlayStation." },
  xbox: { title: "COMPATÍVEL COM XBOX", note: "A mesma lista vale no Xbox." },
};

type CompatSealProps = {
  compat: GuideCompat;
  /** Steam and PlayStation list sizes (robot report): with them, a Steam-only guide covers both versions. */
  counts: { steam: number; psn: number } | null;
};

export function CompatSeal({ compat, counts }: CompatSealProps) {
  if (compat === "steam_only" && counts) {
    return (
      <p className="wk-compat ok">
        <i aria-hidden="true">✓</i>
        <b>STEAM E PLAYSTATION</b>
        <span>
          {counts.steam} conquistas na Steam · {counts.psn} troféus no PlayStation. Os passos marcam quais valem nas
          duas.
        </span>
      </p>
    );
  }
  if (compat === "steam_only") {
    return (
      <p className="wk-compat">
        <i aria-hidden="true">!</i>
        <b>APENAS STEAM</b>
        <span>A lista de outras plataformas é diferente. Os passos marcam o que vale em cada uma.</span>
      </p>
    );
  }
  const { title, note } = COMPATIBLE[compat];
  return (
    <p className="wk-compat ok">
      <i aria-hidden="true">✓</i>
      <b>{title}</b>
      <span>{note}</span>
    </p>
  );
}

type PsnListSealProps = {
  /** PSN trophies the guide follows (psnList.total). */
  trophies: number;
  /** Steam achievements without a route (steamOnly). */
  steamOnly: number;
};

export function PsnListSeal({ trophies, steamOnly }: PsnListSealProps) {
  return (
    <p className="wk-compat psn">
      <i aria-hidden="true">✓</i>
      <b>GUIA PELA LISTA DA PSN ({trophies} troféus)</b>
      <span>
        {steamOnly === 0
          ? "Todas as conquistas da Steam também estão no roteiro."
          : steamOnly === 1
            ? "A conquista que só existe na Steam ainda não tem roteiro; quando aparecer fonte, o guia é atualizado."
            : `As ${steamOnly} conquistas que só existem na Steam ainda não têm roteiro; quando aparecer fonte, o guia é atualizado.`}
      </span>
    </p>
  );
}
