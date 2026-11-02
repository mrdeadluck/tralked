"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { updateProfileAction } from "@/app/conta/actions";
import { Button } from "@/components/ui/Button";
import { BIO_MAX } from "@/lib/accounts/limits";

type ProfileFormProps = { bio: string; profilePublic: boolean; handle: string };

/** Bio (plain text) and profile visibility. */
export function ProfileForm({ bio: initialBio, profilePublic: initialPublic, handle }: ProfileFormProps) {
  const router = useRouter();
  const id = useId();
  const [bio, setBio] = useState(initialBio);
  const [profilePublic, setProfilePublic] = useState(initialPublic);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSave] = useTransition();
  const remaining = BIO_MAX - bio.length;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    startSave(async () => {
      const result = await updateProfileAction({ bio, profilePublic });
      if (!result.ok) {
        setStatus({ ok: false, message: result.error });
        return;
      }
      setStatus({ ok: true, message: "Perfil salvo." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-bio`} className="text-sm font-semibold">
          Bio
        </label>
        <p id={`${id}-bio-hint`} className="text-[13px] text-muted">
          Aparece na sua ficha de personagem. Só texto: links começando com https viram links.
        </p>
        <textarea
          id={`${id}-bio`}
          name="bio"
          rows={4}
          maxLength={BIO_MAX}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          aria-describedby={`${id}-bio-hint ${id}-bio-count`}
          placeholder="Caçador de platinas desde o PS3. Soulslike no hard."
          className="mt-1 resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[15.5px] leading-relaxed text-text focus:border-text"
        />
        <span
          id={`${id}-bio-count`}
          className={`self-end font-mono text-xs tabular-nums ${remaining < 20 ? "text-rarity-lendario" : "text-dim"}`}
        >
          {remaining} de {BIO_MAX} caracteres restantes
        </span>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-sm font-semibold">Quem vê seu personagem</legend>
        <VisibilityOption
          name={`${id}-visibility`}
          checked={profilePublic}
          onSelect={() => setProfilePublic(true)}
          title="Público"
          text={`Qualquer pessoa vê /jogador/${handle}, e você aparece nos highscores e no ranking da família.`}
        />
        <VisibilityOption
          name={`${id}-visibility`}
          checked={!profilePublic}
          onSelect={() => setProfilePublic(false)}
          title="Privado"
          text="Só você vê a ficha. Você sai dos highscores; fotos, comentários e posts continuam públicos."
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar perfil"}
        </Button>
        <p aria-live="polite" className="text-sm">
          {status ? (
            <span role={status.ok ? undefined : "alert"} className={status.ok ? "text-acc" : "text-nin"}>
              {status.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}

function VisibilityOption({
  name,
  checked,
  onSelect,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[2px] border px-4 py-3 has-focus-visible:outline-2 has-focus-visible:outline-acc ${
        checked ? "border-acc bg-hover" : "border-line-2 hover:border-text-3"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 flex-none accent-(--acc)"
      />
      <span className="flex flex-col gap-0.5">
        <b className="text-[15px] font-semibold">{title}</b>
        <span className="text-[13.5px] text-muted">{text}</span>
      </span>
    </label>
  );
}
