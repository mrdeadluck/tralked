"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeRoleAction } from "@/app/admin/usuarios/actions";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/admin/roles";
import { FILTER_SELECT } from "./ui";

/** Role of one user (admin only). Changing it asks for confirmation and saves at once. */
export function RoleSelect({ userId, handle, role }: { userId: string; handle: string; role: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onChange(next: string) {
    if (!window.confirm(`Mudar @${handle} para ${ROLE_LABEL[next as Role] ?? next}?`)) return;
    const previous = value;
    setValue(next);
    setError(null);
    start(async () => {
      const result = await changeRoleAction({ userId, role: next });
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Papel de @${handle}`}
        className={`${FILTER_SELECT} w-[150px]`}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-[12px] text-nin">
          {error}
        </span>
      ) : null}
    </span>
  );
}
