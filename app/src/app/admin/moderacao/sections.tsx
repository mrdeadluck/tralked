import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminSection, Empty, StatusBadge, TableRegion, TABLE, TD, TH, When } from "@/components/admin/ui";
import { Pager } from "@/components/community/Pager";
import { SanctionForm } from "@/components/moderation/SanctionForm";
import { liftSanctionAction } from "@/lib/moderation/actions";
import { listModerationLog } from "@/lib/moderation/log";
import { listActiveSanctions } from "@/lib/moderation/sanctions";

/** Sections of /admin/moderacao added with the moderation log: sanctions and history. */

const TARGET_LABEL: Record<string, string> = {
  comment: "Comentário",
  post: "Resposta no fórum",
  thread: "Tópico",
  photo: "Foto",
  article: "Notícia",
  guide: "Guia",
  user: "Usuário",
  report: "Denúncia",
};

/** Today in Brasília as YYYY-MM-DD (the earliest end date of a sanction). */
const todayBrasilia = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export async function Sanctions({ handle }: { handle: string | undefined }) {
  const now = new Date();
  const active = await listActiveSanctions(now);
  return (
    <>
      <AdminSection title="Silenciar ou banir">
        <SanctionForm handle={handle?.replace(/^@/, "") ?? ""} minDate={todayBrasilia(now)} />
      </AdminSection>
      <AdminSection title="Punições em vigor">
        {active.length === 0 ? (
          <Empty title="Ninguém silenciado ou banido agora." />
        ) : (
          <TableRegion label="Punições em vigor">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Usuário</th>
                  <th scope="col" className={TH}>Punição</th>
                  <th scope="col" className={TH}>Até</th>
                  <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {active.flatMap((u) =>
                  (
                    [
                      ["ban", u.bannedUntil],
                      ["mute", u.mutedUntil],
                    ] as const
                  )
                    .filter(([, until]) => until !== null)
                    .map(([kind, until]) => (
                      <tr key={`${u.id}-${kind}`} className="hover:bg-hover">
                        <td className={TD}>
                          <Link href={`/jogador/${u.handle}`} className="text-acc underline underline-offset-4 hover:no-underline">
                            @{u.handle}
                          </Link>
                          <span className="block text-[13px] text-text-3">{u.displayName}</span>
                        </td>
                        <td className={TD}>
                          <StatusBadge status={kind === "ban" ? "removed" : "hidden"} label={kind === "ban" ? "Banido" : "Silenciado"} />
                        </td>
                        <td className={TD}>
                          <When date={until} />
                        </td>
                        <td className={TD}>
                          <span className="flex justify-end">
                            <ActionButton
                              action={liftSanctionAction}
                              input={{ userId: u.id, kind }}
                              label={kind === "ban" ? "Tirar banimento" : "Tirar silêncio"}
                              ariaLabel={`${kind === "ban" ? "Tirar banimento" : "Tirar silêncio"} de @${u.handle}`}
                              confirm={`Encerrar a punição de @${u.handle} agora?`}
                            />
                          </span>
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </TableRegion>
        )}
      </AdminSection>
    </>
  );
}

/** "from → to" or "até <date>" from a log entry's details. */
function DetailsText({ details }: { details: unknown }) {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (typeof d.until === "string") {
    return (
      <span className="text-[13px] text-text-3">
        até <When date={new Date(d.until)} />
      </span>
    );
  }
  if (d.from !== undefined && d.to !== undefined) {
    return (
      <span className="font-mono text-[12px] text-text-3">
        {String(d.from)} → {String(d.to)}
      </span>
    );
  }
  return null;
}

export async function ModerationHistory({ page }: { page: number }) {
  const { entries, page: current, pageCount } = await listModerationLog(page);
  const href = (p: number) => `/admin/moderacao?aba=historico${p > 1 ? `&pagina=${p}` : ""}`;
  return (
    <>
      {entries.length === 0 ? (
        <Empty title="Nenhuma ação de moderação ainda.">Cada passo da moderação (remover, fixar, trancar, punir) fica registrado aqui.</Empty>
      ) : (
        <TableRegion label="Histórico de moderação">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Quando</th>
                <th scope="col" className={TH}>Quem</th>
                <th scope="col" className={TH}>O quê</th>
                <th scope="col" className={TH}>Alvo</th>
                <th scope="col" className={TH}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-hover">
                  <td className={TD}>
                    <When date={e.createdAt} />
                  </td>
                  <td className={TD}>{e.actor ? `@${e.actor}` : <span className="text-dim">conta removida</span>}</td>
                  <td className={TD}>
                    <span className="block text-[14px]">{e.label}</span>
                    <DetailsText details={e.details} />
                  </td>
                  <td className={TD}>
                    <span className="block font-mono text-xs tracking-[0.08em] text-dim uppercase">
                      {TARGET_LABEL[e.targetType] ?? e.targetType}
                    </span>
                    {e.targetUser ? <span className="text-[13px] text-text-3">@{e.targetUser}</span> : null}
                  </td>
                  <td className={`${TD} max-w-[320px]`}>
                    {e.reason ? <p className="text-[14px] break-words whitespace-pre-line">{e.reason}</p> : <span className="text-dim">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <Pager page={current} pageCount={pageCount} href={href} label="Páginas do histórico" />
    </>
  );
}
