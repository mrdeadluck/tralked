import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { GuideRequestForm } from "@/components/admin/GuideRequestForm";
import { AdminHead, AdminSection, Empty, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { requireStaffPage } from "@/lib/admin/guard";
import { listGuideRequests, REQUEST_STATUS_LABEL } from "@/lib/guide-requests/queue";
import {
  bumpPriorityAction,
  cancelRequestAction,
  retryRequestAction,
} from "./actions";

export const metadata: Metadata = { title: "Pedidos de guia" };
// Session-dependent: blocks on the server (see admin/layout.tsx).
export const instant = false;

const CANCELLABLE = ["queued", "researching", "writing", "waiting_sources"];
const RETRYABLE = ["waiting_sources", "failed", "cancelled"];

export default async function GuideRequestsPage() {
  await requireStaffPage();
  const requests = await listGuideRequests();

  return (
    <>
      <AdminHead
        title="Pedidos de guia"
        lede={
          <>
            O robô pega um pedido por vez, do maior para o menor peso. Sem fontes suficientes, ele tenta de novo a cada 3 dias, por até 30.{" "}
            <Link href="/admin/guias" className="text-acc underline underline-offset-4 hover:no-underline">
              Voltar aos guias
            </Link>
          </>
        }
      />
      <AdminSection title="Novo pedido">
        <GuideRequestForm />
      </AdminSection>
      {requests.length === 0 ? (
        <Empty title="Nenhum pedido ainda.">Peça o guia de um jogo acima; o robô o encontra na fila.</Empty>
      ) : (
        <TableRegion label="Pedidos de guia">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Jogo</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Tentativas</th>
                <th scope="col" className={TH}>Próxima tentativa</th>
                <th scope="col" className={TH}>Motivo e relatório</th>
                <th scope="col" className={TH}>Guia</th>
                <th scope="col" className={TH}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const game = r.gameName ?? `Steam ${r.steamAppId}`;
                return (
                  <tr key={r.id} className="hover:bg-hover">
                    <td className={TD}>
                      <span className="font-semibold">{game}</span>
                      <span className="block font-mono text-xs text-dim">
                        {r.steamAppId}
                        {r.priority !== 0 ? ` · peso ${r.priority > 0 ? "+" : ""}${r.priority}` : ""}
                      </span>
                    </td>
                    <td className={TD}>
                      <StatusBadge status={r.status} label={REQUEST_STATUS_LABEL[r.status] ?? r.status} />
                    </td>
                    <td className={TD}>
                      <span className="font-mono text-[13px] tabular-nums">{r.attempts}</span>
                    </td>
                    <td className={TD}>
                      <When date={r.nextAttemptAt} />
                    </td>
                    <td className={TD}>
                      {r.reason ? <p className="max-w-[40ch] text-[13px] text-text-2">{r.reason}</p> : null}
                      {r.report ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer font-mono text-xs text-dim uppercase">Relatório</summary>
                          <pre className="mt-1 max-h-64 max-w-[48ch] overflow-auto text-[12px] whitespace-pre-wrap text-text-3">
                            {JSON.stringify(r.report, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      {!r.reason && !r.report ? <span className="text-dim">—</span> : null}
                    </td>
                    <td className={TD}>
                      {r.guideId ? (
                        <Link href={`/admin/guias/${r.guideId}`} className="text-acc underline underline-offset-4 hover:no-underline">
                          Abrir guia
                        </Link>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        {CANCELLABLE.includes(r.status) ? (
                          <>
                            <ActionButton action={bumpPriorityAction} input={{ id: r.id, delta: 1 }} label="Prioridade ↑" ariaLabel={`Subir a prioridade de ${game}`} />
                            <ActionButton action={bumpPriorityAction} input={{ id: r.id, delta: -1 }} label="Prioridade ↓" ariaLabel={`Baixar a prioridade de ${game}`} />
                          </>
                        ) : null}
                        {RETRYABLE.includes(r.status) ? (
                          <ActionButton action={retryRequestAction} input={{ id: r.id }} label="Tentar agora" ariaLabel={`Tentar agora o guia de ${game}`} />
                        ) : null}
                        {CANCELLABLE.includes(r.status) ? (
                          <ActionButton
                            action={cancelRequestAction}
                            input={{ id: r.id }}
                            label="Cancelar"
                            ariaLabel={`Cancelar o pedido de ${game}`}
                            tone="danger"
                            confirm={`Cancelar o pedido de guia de ${game}?`}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      )}
    </>
  );
}
