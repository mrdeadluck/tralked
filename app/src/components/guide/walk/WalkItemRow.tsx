"use client";

import { useEffect, useRef, useState } from "react";
import { toggleItem } from "@/app/jogos/[slug]/guia/actions";
import { loginHref, pctText } from "@/components/guide/format";
import { useWalkProgress } from "./progress";
import { walkInline } from "./inline";
import { revealedInline, SpoilerGate, useGatedItem } from "./spoilers";
import { locationScope, type ItemImage, type ItemSource, type ItemView } from "./view";

/*
 * One item of a step (collectible, achievement, mission...): its seals, location, image with credit
 * and sources, and the box to mark it as done. Marking an achievement asks Steam right away
 * (checkGameAchievements): confirmed → "TRALKED!" and the XP; not yet → "aguardando", checked again
 * after 30 s and 90 s while the page is open (the regular sync confirms it later otherwise). A manual
 * tick never pays XP. Gated items (spoilers, hidden achievements) show their text only on reveal.
 */

/** Second checks after a tick Steam did not confirm yet, counted from the first one. */
const RECHECK_MS = [30_000, 90_000];

type SteamStatus = "checking" | "waiting" | "invite" | "error" | "login" | "unpublished" | "gone" | null;

const STATUS_TEXT: Record<Exclude<SteamStatus, null | "login" | "invite">, string> = {
  checking: "Conferindo na Steam…",
  waiting: "marcada por você · a Steam ainda não mostrou",
  error: "Não foi possível falar com a Steam agora",
  unpublished: "Prévia: marcar fica para quando o guia for publicado.",
  gone: "Este item mudou no guia. Recarregue a página.",
};

const ALSO_ON: Record<"psn" | "xbox", string> = { psn: "PlayStation", xbox: "Xbox" };

function Sources({ sources, review }: { sources: ItemSource[]; review: boolean }) {
  const n = sources.length;
  const confirmed = n >= 2 && !review;
  return (
    <p className="src">
      <span className={confirmed ? "two" : "one"}>
        {confirmed ? `✓ ${n} fontes` : `● ${n} ${n === 1 ? "fonte" : "fontes"}${review ? " · em revisão" : ""}`}
      </span>
      {" · "}
      {sources.map((s, i) => (
        <span key={i}>
          {i > 0 ? ", " : null}
          {s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}
            </a>
          ) : (
            s.name
          )}
        </span>
      ))}
    </p>
  );
}

/** The location image, whole (a third party's watermark is never covered), with its credit below. */
function Shot({ image, name }: { image: ItemImage; name: string }) {
  return (
    <figure className="wk-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={`Onde fica: ${name}`} loading="lazy" decoding="async" />
      <figcaption>
        Imagem:{" "}
        {image.sourceUrl ? (
          <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">
            {image.sourceName}
          </a>
        ) : (
          image.sourceName
        )}
      </figcaption>
    </figure>
  );
}

function Seals({ item }: { item: ItemView }) {
  return (
    <>
      {item.missable ? <span className="wk-tag miss">perdível · pegue agora</span> : null}
      {item.returnLater ? <span className="wk-tag back">dá para voltar depois</span> : null}
      {item.index !== null && item.total !== null ? (
        <span className="wk-tag col">
          {item.collectibleType ?? "coletável"} {item.index}/{item.total}
        </span>
      ) : null}
      {item.alsoOn.length > 0 ? (
        <span className="wk-tag plat">também no {item.alsoOn.map((p) => ALSO_ON[p]).join("/")}</span>
      ) : null}
    </>
  );
}

export function WalkItemRow({ item }: { item: ItemView }) {
  const progress = useWalkProgress();
  const gateId = `item-${item.ref}`;
  const revealed = useGatedItem(gateId, item.ref);
  const [status, setStatus] = useState<SteamStatus>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Rechecks run later: they read the page's latest state, not the one of the tick.
  const latest = useRef(progress);
  latest.current = progress;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const achievement = item.achievement;
  const done = progress.isDone(item.ref);
  const confirmed = achievement ? progress.isUnlocked(achievement.id) : false;

  const name = item.name ?? revealed?.name ?? null;
  const image = item.image ?? revealed?.image ?? null;
  const sources = revealed?.sources ?? item.sources;
  const achName = achievement?.name ?? revealed?.achievement?.name ?? null;
  const achDescription = achievement?.description ?? revealed?.achievement?.description ?? null;
  const achIcon = achievement?.iconUrl ?? revealed?.achievement?.iconUrl ?? null;
  const label = name ?? "item com spoiler";

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /** One Steam check for this row's achievement; `first` schedules the rechecks. */
  async function askSteam(id: string, first: boolean) {
    if (first) setStatus("checking");
    let result;
    try {
      result = await latest.current.check();
    } catch {
      setStatus("error");
      return;
    }
    if (latest.current.isUnlocked(id) || result.newUnlocks.some((u) => u.id === id)) {
      clearTimers();
      setStatus(null);
      return;
    }
    switch (result.status) {
      case "ok":
      case "cooldown":
        setStatus("waiting");
        if (first) timers.current = RECHECK_MS.map((ms) => setTimeout(() => void askSteam(id, false), ms));
        return;
      case "unlinked":
      case "private":
        clearTimers();
        setStatus("invite");
        return;
      case "unauthenticated":
        clearTimers();
        setStatus("login");
        return;
      case "error":
        // A recheck that fails keeps waiting; the first one says Steam could not be reached.
        if (first) setStatus("error");
        return;
    }
  }

  async function onTick() {
    if (!progress.user) {
      setStatus("login");
      return;
    }
    const next = !done;
    progress.setDone(item.ref, next);
    let result;
    try {
      result = await toggleItem(progress.guideId, item.ref);
    } catch {
      progress.setDone(item.ref, done);
      setStatus("error");
      return;
    }
    if (result.status !== "ok") {
      progress.setDone(item.ref, done);
      setStatus(result.status === "unauthenticated" ? "login" : progress.preview ? "unpublished" : "gone");
      return;
    }
    if (result.done !== next) progress.setDone(item.ref, result.done);
    clearTimers();
    setStatus(null);
    if (result.done && achievement && !latest.current.isUnlocked(achievement.id)) await askSteam(achievement.id, true);
  }

  const title = (
    <h4>
      {name ?? (
        <SpoilerGate id={gateId} what="o item com spoiler">
          <span className="text-muted">…</span>
        </SpoilerGate>
      )}{" "}
      <Seals item={item} />
    </h4>
  );

  return (
    <div className={`wk-item${done ? " done" : ""}${achievement ? " ach" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Marcar ${label} como feito`}
        className="chk"
        onClick={() => void onTick()}
      />
      <div className="wk-item-b">
        {achievement ? (
          <div className="wk-ach">
            {achIcon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={achIcon} alt="" width={52} height={52} loading="lazy" />
            ) : (
              <span className="noimg" aria-hidden="true" />
            )}
            <div>
              {title}
              {achName && achName !== name ? <p className="d">Conquista: {achName}</p> : null}
              {achDescription ? <p className="d">{achDescription}</p> : null}
              {achievement.globalPct !== null ? (
                <p className="rar">{pctText(Math.round(achievement.globalPct * 10) / 10)} dos jogadores na Steam</p>
              ) : null}
            </div>
          </div>
        ) : (
          title
        )}
        {item.location ? (
          <p className="d">{walkInline(item.location, locationScope(item.ref))}</p>
        ) : revealed?.location ? (
          <p className="d">{revealedInline(revealed.location)}</p>
        ) : null}
        {image && name ? <Shot image={image} name={name} /> : null}
        <Sources sources={sources} review={item.review} />
        {achievement && confirmed && done ? <p className="wk-steam ok">✓ Confirmada pela Steam</p> : null}
        {status && !(confirmed && status !== "login") ? <StatusLine status={status} returnTo={progress.returnTo} /> : null}
      </div>
    </div>
  );
}

function StatusLine({ status, returnTo }: { status: Exclude<SteamStatus, null>; returnTo: string }) {
  if (status === "login") {
    return (
      <p className="wk-steam" role="status">
        <a href={loginHref(returnTo)}>Entre para marcar</a> os itens do detonado.
      </p>
    );
  }
  if (status === "invite") {
    return (
      <p className="wk-steam" role="status">
        <a href="/conta/conexoes">Ligue sua Steam para conferir</a>
      </p>
    );
  }
  return (
    <p className={status === "error" ? "wk-steam err" : "wk-steam"} role="status">
      {STATUS_TEXT[status]}
    </p>
  );
}
