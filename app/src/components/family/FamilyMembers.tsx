import { Chip } from "@/components/ui/Chip";
import type { FamilyMemberInfo } from "@/lib/family/service";

type FamilyMembersProps = {
  members: FamilyMemberInfo[];
  maxMembers: number;
  meId?: string;
};

export function FamilyMembers({ members, maxMembers, meId }: FamilyMembersProps) {
  const hasPrivate = members.some((m) => !m.profilePublic);
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase">
        {members.length} de {maxMembers} membros
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-[4px] border border-line bg-surface">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 px-[22px] py-3.5">
            <div className="flex flex-col">
              <span className="font-bold">
                {member.displayName}
                {member.userId === meId ? " (você)" : ""}
              </span>
              <span className="font-mono text-xs text-dim">@{member.handle}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {member.role === "owner" ? <Chip color="var(--acc)">Dono</Chip> : null}
              {!member.profilePublic ? <Chip plain>Perfil privado</Chip> : null}
            </div>
          </li>
        ))}
      </ul>
      {hasPrivate ? (
        <p className="text-sm text-muted">
          Quem está com o perfil privado não entra na biblioteca, no ranking nem no &quot;Quase lá&quot; da
          família. Para aparecer, deixe o perfil público nas configurações de privacidade da Steam.
        </p>
      ) : null}
    </div>
  );
}
