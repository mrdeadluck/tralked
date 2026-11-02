"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { announceReward } from "@/components/fx/reward-bus";
import { loginHref } from "@/components/guide/format";
import type { UploadResponse } from "@/app/galeria/enviar/route";
import { PHOTO_XP } from "@/lib/community/rewards";
import { CAPTION_MAX } from "@/lib/community/text";
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from "@/lib/community/upload-limits";
import type { UploadGameOption } from "@/lib/community/gallery";
import { compressForUpload } from "./compress-image";
import { UploadIcon } from "./icons";
import { UploadGamePicker } from "./UploadGamePicker";

/** Files above this are refused before the browser even tries to decode them. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const SOURCE_TOO_LARGE = "Essa imagem é grande demais. Escolha uma de até 40 MB.";
const ACCEPT = "image/jpeg,image/png,image/webp";

type UploadPhotoProps = {
  loggedIn: boolean;
  returnTo: string;
  /** Preselected game (the gallery filter). The form searches the catalog itself (UploadGamePicker). */
  defaultGame?: UploadGameOption | null;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
};

type Outcome = { kind: "error"; field?: string; message: string } | { kind: "done"; href: string; xp: boolean };

/** "Poste sua foto": file + game + caption, sent to the upload route (the server re-checks everything). */
export function UploadPhoto({ loggedIn, returnTo, defaultGame, pending = false }: UploadPhotoProps) {
  const router = useRouter();
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  if (!loggedIn) {
    return (
      <a
        href={pending ? undefined : loginHref(returnTo)}
        aria-disabled={pending || undefined}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] aria-disabled:opacity-45"
      >
        Entrar para enviar
      </a>
    );
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setOutcome(null);
    setPreview(file ? URL.createObjectURL(file) : null);
    if (file && file.size > MAX_SOURCE_BYTES) {
      setOutcome({ kind: "error", field: "foto", message: SOURCE_TOO_LARGE });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("foto");
    if (!(file instanceof File) || file.size === 0) {
      setOutcome({ kind: "error", field: "foto", message: "Escolha uma foto para enviar." });
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setOutcome({ kind: "error", field: "foto", message: SOURCE_TOO_LARGE });
      return;
    }
    if (!data.get("jogo")) {
      setOutcome({ kind: "error", field: "jogo", message: "Escolha o jogo da foto na lista da busca." });
      return;
    }
    startTransition(async () => {
      // Resize and re-encode here, so the request fits the platform's body limit.
      const compressed = await compressForUpload(file);
      const upload = compressed ?? file;
      if (upload.size > MAX_UPLOAD_BYTES) {
        setOutcome({
          kind: "error",
          field: "foto",
          message: compressed ? TOO_LARGE_MESSAGE : "Envie uma imagem JPEG, PNG ou WebP de verdade.",
        });
        return;
      }
      data.set("foto", upload, upload.name);

      let body: UploadResponse;
      try {
        const response = await fetch("/galeria/enviar", {
          method: "POST",
          body: data,
          headers: { accept: "application/json" },
        });
        body = (await response.json()) as UploadResponse;
      } catch {
        setOutcome({ kind: "error", message: "Não foi possível enviar agora. Confira sua conexão e tente de novo." });
        return;
      }
      if (body.status === "ok") {
        form.reset();
        setPreview(null);
        setOutcome({ kind: "done", href: body.href, xp: body.xpAwarded });
        announceReward(
          body.xpAwarded
            ? {
                xpGained: PHOTO_XP,
                reason: "Foto publicada",
                levelUp: body.levelUp ?? null,
                progress: body.progress ?? null,
                weekXp: body.weekXp ?? null,
              }
            : null,
        );
        router.refresh();
        return;
      }
      setOutcome({ kind: "error", field: "field" in body ? body.field : undefined, message: body.message });
    });
  }

  const fieldError = (field: string) =>
    outcome?.kind === "error" && outcome.field === field ? outcome.message : null;
  const generalError = outcome?.kind === "error" && !outcome.field ? outcome.message : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label
          htmlFor={`${id}-foto`}
          className="group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[2px] border border-dashed border-line-2 bg-bg text-center hover:border-dim has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-acc"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview of the chosen file
            <img src={preview} alt="Prévia da foto escolhida" className="absolute inset-0 size-full object-cover" />
          ) : (
            <>
              <UploadIcon width={22} height={22} className="text-acc" />
              <span className="text-[14px] font-bold">Escolher foto</span>
              <span className="font-mono text-xs text-dim">JPEG, PNG ou WebP · reduzimos para 2048 px antes de enviar</span>
            </>
          )}
          <input
            id={`${id}-foto`}
            name="foto"
            type="file"
            accept={ACCEPT}
            required
            onChange={onFile}
            aria-describedby={fieldError("foto") ? `${id}-foto-error` : undefined}
            className="sr-only"
          />
        </label>
        {fieldError("foto") ? (
          <p id={`${id}-foto-error`} role="alert" className="text-[13px] text-nin">
            {fieldError("foto")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <UploadGamePicker
          name="jogo"
          defaultGame={defaultGame}
          invalid={Boolean(fieldError("jogo"))}
          errorId={`${id}-jogo-error`}
        />
        {fieldError("jogo") ? (
          <span id={`${id}-jogo-error`} role="alert" className="text-[13px] text-nin">
            {fieldError("jogo")}
          </span>
        ) : null}
      </div>

      <label className="flex flex-col gap-1.5 text-[13px] text-muted">
        Legenda (opcional)
        <textarea
          name="legenda"
          rows={2}
          maxLength={CAPTION_MAX}
          className="resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[14px] text-text"
        />
        {fieldError("legenda") ? (
          <span role="alert" className="text-[13px] text-nin">
            {fieldError("legenda")}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Enviando…" : "Enviar foto"}
      </button>

      {generalError ? (
        <p role="alert" className="text-[13px] text-nin">
          {generalError}
        </p>
      ) : null}
      {outcome?.kind === "done" ? (
        <p role="status" className="text-[14px] text-text-2">
          Foto publicada{outcome.xp ? <b className="text-acc"> · +{PHOTO_XP} XP</b> : " · limite diário de XP já atingido"}.{" "}
          <Link href={outcome.href} className="text-acc underline underline-offset-2">
            Ver sua foto
          </Link>
        </p>
      ) : null}
    </form>
  );
}
