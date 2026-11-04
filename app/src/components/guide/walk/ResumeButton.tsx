"use client";

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
        <button type="button" className="tk-cut-b" onClick={goToEnd}>
          Guia concluído
        </button>
        <SyncControl />
        <BehindLink refs={at.behind} />
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
    </div>
  );
}
