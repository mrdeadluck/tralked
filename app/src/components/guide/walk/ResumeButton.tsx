"use client";

import { useState } from "react";
import { loginHref } from "@/components/guide/format";
import { useWalkProgress } from "./progress";
import { useResume } from "./resume-state";
import { BehindLink } from "./ResumeMarker";

/*
 * The cover's "Continuar de onde parou". Anonymous: a small invitation to sign in (the guide stays
 * open to everyone; only members get a resume point). Signed in: a skeleton while the session
 * streams in, then the button by state (clicking it scrolls to the resume item and highlights it)
 * and "Sincronizar conquistas", which asks Steam and then takes the visitor to where they are. A
 * visitor whose Steam does not show the game gets the invitation to link Steam instead.
 */

const LINK_STEAM = "/conta/conexoes";

function SyncControl() {
  const { user, returnTo } = useWalkProgress();
  const { sync, syncStatus } = useResume();
  if (!user) return null;
  if (user.unlockedCount === null || syncStatus === "invite") {
    return (
      <a className="wk-sync-in" href={LINK_STEAM}>
        Ligue sua Steam para sincronizar
      </a>
    );
  }
  if (syncStatus === "login") {
    return (
      <a className="wk-sync-in" href={loginHref(returnTo)}>
        Entre de novo para sincronizar
      </a>
    );
  }
  const busy = syncStatus === "syncing";
  return (
    <>
      <button type="button" className="wk-sync tk-cut-b" onClick={() => void sync()} disabled={busy} aria-busy={busy}>
        {busy ? "Sincronizando…" : "Sincronizar conquistas"}
      </button>
      {syncStatus === "error" ? <small className="err">Não foi possível falar com a Steam agora</small> : null}
    </>
  );
}

/**
 * "Recomeçar o guia": for a member with ticks, clears them all after an inline confirmation (no
 * browser dialog). Steam unlocks stay done; the resume point then follows them alone.
 */
function ResetControl() {
  const { user, tickedCount, resetTicks } = useWalkProgress();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done" | "error">("idle");
  if (!user) return null;
  if (state === "done") return <small role="status">Marcações apagadas. O guia recomeça do início.</small>;
  if (tickedCount === 0) return null;
  if (state === "idle") {
    return (
      <button type="button" className="wk-reset" onClick={() => setState("confirm")}>
        Recomeçar o guia
      </button>
    );
  }
  const run = async () => {
    setState("busy");
    try {
      const result = await resetTicks();
      setState(result.status === "ok" ? "done" : "error");
    } catch {
      setState("error");
    }
  };
  const busy = state === "busy";
  return (
    <div className="wk-reset-q" role="group" aria-label="Recomeçar o guia">
      <p>
        Apagar {tickedCount === 1 ? "a 1 marcação" : `as ${tickedCount} marcações`} que você fez neste guia? As
        conquistas que a Steam confirmou continuam marcadas.
      </p>
      <button type="button" className="wk-reset-yes" onClick={() => void run()} disabled={busy} aria-busy={busy}>
        {busy ? "Apagando…" : "Apagar marcações"}
      </button>
      <button type="button" className="wk-reset" onClick={() => setState("idle")} disabled={busy}>
        Cancelar
      </button>
      {state === "error" ? <small className="err">Não foi possível apagar agora. Tente de novo.</small> : null}
    </div>
  );
}

export function ResumeButton() {
  const { session, at, chapters, goTo, goToEnd } = useResume();
  const { returnTo } = useWalkProgress();

  if (session === "anon") {
    return (
      <p className="wk-resume-in">
        <a href={loginHref(returnTo)}>Entre para continuar de onde parou</a>
      </p>
    );
  }
  if (!at) return <span className="wk-resume-sk tk-cut-b" aria-hidden="true" />;

  const point = at.resume;
  if (!point) {
    return (
      <div className="wk-resume">
        {/* "Concluído" only when nothing was left behind on the way. */}
        <button type="button" className="tk-cut-b" onClick={goToEnd}>
          {at.behind.length > 0 ? "Você chegou ao fim do detonado" : "Guia concluído"}
        </button>
        <SyncControl />
        <BehindLink refs={at.behind} />
        <ResetControl />
      </div>
    );
  }
  const chapter = chapters[point.chapter];
  return (
    <div className="wk-resume">
      <button type="button" className="tk-cut-b" onClick={() => goTo(point.ref)}>
        {at.furthest === null ? "Começar o detonado" : "Continuar de onde parou"}
      </button>
      <SyncControl />
      {chapter ? (
        <small>
          {chapter.title} · passo {point.step}
        </small>
      ) : null}
      <ResetControl />
    </div>
  );
}
