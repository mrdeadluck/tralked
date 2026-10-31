"use client";

import { useState } from "react";
import { leaveFamilyAction } from "@/app/familia/actions";
import { Button } from "@/components/ui/Button";

export function LeaveFamilyButton({
  isOwner,
  isLastMember,
}: {
  isOwner: boolean;
  isLastMember: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Sair da família
      </Button>
    );
  }

  const warning = isLastMember
    ? "Você é o último membro: a família será apagada."
    : isOwner
      ? "Você é o dono: a família passa para o membro mais antigo."
      : "Você deixa de ver a biblioteca conjunta.";

  return (
    <form action={leaveFamilyAction} className="flex flex-col gap-3">
      <p role="alert" className="text-sm text-text-2">
        {warning}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit">
          Confirmar saída
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
