import type { GuideCompat } from "@/lib/content/walkthrough-schema";

/*
 * Platform seal of a walkthrough. The Steam list is the master list: "APENAS STEAM" (amber) when
 * the other platforms' lists differ, with both sizes when the robot report has them; otherwise
 * which other lists it also covers (lime).
 */

const COMPATIBLE: Record<Exclude<GuideCompat, "steam_only">, { title: string; note: string }> = {
  psn_xbox: { title: "COMPATÍVEL COM PSN E XBOX", note: "A mesma lista vale no PlayStation e no Xbox." },
  psn: { title: "COMPATÍVEL COM PSN", note: "A mesma lista vale no PlayStation." },
  xbox: { title: "COMPATÍVEL COM XBOX", note: "A mesma lista vale no Xbox." },
};

type CompatSealProps = {
  compat: GuideCompat;
  /** Steam and PS5 list sizes (robot report), for "APENAS STEAM". */
  counts: { steam: number; ps5: number } | null;
};

export function CompatSeal({ compat, counts }: CompatSealProps) {
  if (compat === "steam_only") {
    return (
      <p className="wk-compat">
        <i aria-hidden="true">!</i>
        <b>APENAS STEAM</b>
        <span>
          {counts
            ? `Steam tem ${counts.steam} conquistas; o PS5 tem ${counts.ps5}. Os passos marcam quais valem nas duas.`
            : "A lista de outras plataformas é diferente. Os passos marcam o que vale em cada uma."}
        </span>
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
