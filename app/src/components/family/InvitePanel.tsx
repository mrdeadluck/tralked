"use client";

import { useRef, useState, useTransition } from "react";
import { createInviteAction } from "@/app/familia/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type InvitePanelProps = {
  memberCount: number;
  maxMembers: number;
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export function InvitePanel({ memberCount, maxMembers }: InvitePanelProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const full = memberCount >= maxMembers;

  function generate() {
    setError(null);
    setCopied(null);
    startTransition(async () => {
      const result = await createInviteAction();
      if (result.error || !result.url) {
        setError(result.error ?? "Não foi possível criar o convite.");
        return;
      }
      setUrl(result.url);
      setExpiresAt(result.expiresAt ?? null);
    });
  }

  // Runs inside the click handler so the browser keeps the user gesture for the clipboard.
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      // Clipboard blocked (insecure context, permissions): select the URL for manual copy.
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-[19px] leading-[1.15] font-extrabold font-stretch-[105%]">
        Convidar alguém
      </h3>
      <p className="text-sm text-muted">
        {memberCount} de {maxMembers} lugares ocupados. Cada link vale para uma pessoa e expira em 7
        dias.
      </p>

      {url ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-url" className="sr-only">
            Link de convite
          </label>
          <input
            id="invite-url"
            ref={inputRef}
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="h-11 w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 font-mono text-xs text-text"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={copy}>
              Copiar link
            </Button>
            <span aria-live="polite" className="font-mono text-[11px] text-dim">
              {copied === "ok" ? "Link copiado." : null}
              {copied === "manual" ? "Não deu para copiar sozinho: o link está selecionado, use Ctrl+C." : null}
            </span>
          </div>
          {expiresAt ? (
            <p className="font-mono text-[11px] text-dim">
              Expira em {dateFormat.format(new Date(expiresAt))}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <Button variant={url ? "ghost" : "primary"} onClick={generate} disabled={pending || full}>
          {pending ? "Gerando…" : url ? "Gerar outro link" : "Gerar link de convite"}
        </Button>
      </div>
      {full ? (
        <p className="text-sm text-muted">A família está cheia. Libere um lugar para convidar mais gente.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-nin">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
