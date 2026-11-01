import Link from "next/link";
import { formatHours } from "@/components/profile/format";
import type { FamilyLibraryView } from "@/lib/family/service";

/** Top of /familia: each member's library at a glance, plus the family's totals. */
export function FamilySummary({ view, meId }: { view: FamilyLibraryView; meId: string }) {
  const totalMin = view.members.reduce((sum, m) => sum + m.playtimeMin, 0);
  const shared = view.entries.filter((e) => e.owners.length > 1).length;
  return (
    <div className="flex flex-col gap-4 pt-5">
      <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-[4px] border border-line bg-line">
        {(
          [
            ["Jogos na família", view.entries.length.toLocaleString("pt-BR")],
            ["Em comum", shared.toLocaleString("pt-BR")],
            ["Horas somadas", formatHours(totalMin)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-[0.12em] text-dim-2 uppercase">{label}</dt>
            <dd className="m-0 mt-1 text-2xl font-extrabold font-stretch-[112%] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-0" aria-label="Integrantes">
        {view.members.map((m) => (
          <li key={m.userId} className="rounded-[4px] border border-line bg-surface px-4 py-3">
            <p className="truncate font-bold">
              {m.displayName}
              {m.userId === meId ? " (você)" : ""}
            </p>
            <Link href={`/jogador/${m.handle}`} className="font-mono text-xs text-dim hover:text-acc">
              @{m.handle}
            </Link>
            {m.profilePublic ? (
              <p className="mt-2 font-mono text-[11px] text-text-3">
                {m.gamesOwned.toLocaleString("pt-BR")} jogos · {m.gamesPlayed.toLocaleString("pt-BR")} jogados ·{" "}
                {formatHours(m.playtimeMin)}
              </p>
            ) : (
              <p className="mt-2 font-mono text-[11px] text-dim">Perfil privado: biblioteca oculta</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
