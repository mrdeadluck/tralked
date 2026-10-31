import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminHead, Empty, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { listFraudCases, type FraudCase } from "@/lib/admin/fraud";
import { requireStaffPage } from "@/lib/admin/guard";
import { confirmFraudAction, releaseFraudAction } from "./actions";

export const metadata: Metadata = { title: "Fraude" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const PLATFORM_LABEL: Record<string, string> = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" };
const NUMBER = new Intl.NumberFormat("pt-BR");

function duration(c: FraudCase): string {
  const seconds = Math.round((c.lastAt.getTime() - c.firstAt.getTime()) / 1000);
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Fraud queue (admin only): suspicious unlocks grouped by player and game. */
export default async function FraudPage() {
  await requireStaffPage("admin");
  const cases = await listFraudCases();
  const players = new Set(cases.map((c) => c.userId)).size;

  return (
    <>
      <AdminHead
        title="Fraude"
        lede="Desbloqueios que as regras antifraude marcaram (rajada de conquistas em segundos ou 100% em tempo impossível). Confirmar anula o XP e recalcula o nível. Liberar paga o XP e as regras não marcam mais esses desbloqueios."
      />
      {cases.length === 0 ? (
        <Empty title="Nenhum caso pendente.">As sincronizações marcam desbloqueios suspeitos automaticamente; eles aparecem aqui.</Empty>
      ) : (
        <>
          <p className="font-mono text-[12px] text-dim">
            {cases.length} {cases.length === 1 ? "caso" : "casos"} · {players} {players === 1 ? "jogador" : "jogadores"}
          </p>
          <TableRegion label="Casos de fraude">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Jogador</th>
                  <th scope="col" className={TH}>Jogo</th>
                  <th scope="col" className={TH}>Suspeitos</th>
                  <th scope="col" className={TH}>Janela</th>
                  <th scope="col" className={TH}>XP em jogo</th>
                  <th scope="col" className={TH}><span className="sr-only">Decisão</span></th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const key = { userId: c.userId, gameId: c.gameId, platform: c.platform };
                  const what = `${c.unlocks} desbloqueios de @${c.handle} em ${c.gameName}`;
                  return (
                    <tr key={`${c.userId}-${c.gameId}-${c.platform}`} className="hover:bg-hover">
                      <td className={TD}>
                        <Link href={`/jogador/${c.handle}`} className="font-semibold hover:text-acc hover:underline hover:underline-offset-4">
                          @{c.handle}
                        </Link>
                        <span className="block text-[12px] text-dim">
                          {c.level !== null ? `Nível ${c.level}` : "Sem nível"}
                        </span>
                      </td>
                      <td className={TD}>
                        <Link href={`/jogos/${c.gameSlug}`} className="hover:text-acc hover:underline hover:underline-offset-4">
                          {c.gameName}
                        </Link>
                        <span className="block font-mono text-[11px] text-dim">
                          {PLATFORM_LABEL[c.platform]}
                          {c.playtimeMin !== null ? ` · ${NUMBER.format(Math.round(c.playtimeMin / 60))} h jogadas` : ""}
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="font-mono text-[14px] tabular-nums">
                          {c.unlocks}
                          <span className="text-dim"> / {c.total}</span>
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="font-mono text-[13px] tabular-nums">{duration(c)}</span>
                        <span className="block">
                          <When date={c.firstAt} />
                        </span>
                      </td>
                      <td className={TD}>
                        <span className={`font-mono text-[14px] tabular-nums ${c.paidXp > 0 ? "text-rarity-lendario" : "text-dim"}`}>
                          {NUMBER.format(c.paidXp)}
                        </span>
                        <span className="block text-[12px] text-dim">{c.paidXp > 0 ? "já pago" : "nada pago"}</span>
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap justify-end gap-2">
                          <ActionButton
                            action={confirmFraudAction}
                            input={key}
                            label="Confirmar fraude"
                            ariaLabel={`Confirmar fraude: ${what}`}
                            confirm={`Confirmar fraude em ${what}? O XP é anulado e o nível recalculado.`}
                            tone="danger"
                          />
                          <ActionButton
                            action={releaseFraudAction}
                            input={key}
                            label="Liberar"
                            ariaLabel={`Liberar ${what}`}
                            confirm={`Liberar ${what}? Eles passam a contar XP.`}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableRegion>
        </>
      )}
    </>
  );
}
