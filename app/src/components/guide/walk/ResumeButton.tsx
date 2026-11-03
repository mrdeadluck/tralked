"use client";

import { loginHref } from "@/components/guide/format";
import { useWalkProgress } from "./progress";
import { useResume } from "./resume-state";
import { BehindLink } from "./ResumeMarker";

/*
 * The cover's "Continuar de onde parou". Anonymous: a small invitation to sign in (the guide stays
 * open to everyone; only members get a resume point). Signed in: a skeleton while the session
 * streams in, then the button by state; clicking it scrolls to the resume item and highlights it.
 */

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
      {chapter ? (
        <small>
          {chapter.title} · passo {point.step}
        </small>
      ) : null}
    </div>
  );
}
