"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/components/layout/consent-store";
import type { ContentBlock } from "@/lib/content/schema";

type PostBlock = Extract<ContentBlock, { type: "post" }>;

type Twttr = {
  widgets?: {
    createTweet(id: string, target: HTMLElement, options?: Record<string, unknown>): Promise<HTMLElement | undefined>;
  };
};

const WIDGETS_SRC = "https://platform.twitter.com/widgets.js";

let pending: { script: HTMLScriptElement; ready: Promise<Twttr | null> } | null = null;

/**
 * X's widget script, once per page: it sets X's own cookies, so it only loads with the visitor's
 * consent ("Aceitar todos") or a click on "Carregar post" for one post. Resolves to `window.twttr`,
 * or null when the script does not load (blocked, offline).
 */
function loadWidgets(): Promise<Twttr | null> {
  if (pending && document.contains(pending.script)) return pending.ready;
  const script = document.createElement("script");
  script.src = WIDGETS_SRC;
  script.async = true;
  script.charset = "utf-8";
  const ready = new Promise<Twttr | null>((resolve) => {
    script.addEventListener("load", () => resolve((window as unknown as { twttr?: Twttr }).twttr ?? null));
    script.addEventListener("error", () => resolve(null));
  });
  document.head.appendChild(script);
  pending = { script, ready };
  return ready;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

const LINK = "underline decoration-1 underline-offset-[3px] hover:text-text-2";

/**
 * A post on X in an article. The stored card (text, author, date, link) is always there, so the article
 * reads without X. With consent, X's script draws the official embed in place of the card; without it, a
 * "Carregar post" button loads it for this post only. If X does not draw it, the card stays.
 */
export function XPostEmbed({ block }: { block: PostBlock }) {
  const consent = useConsent();
  const [clicked, setClicked] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  const load = consent === "all" || clicked;
  const statusId = block.url.split("/").pop() ?? "";

  useEffect(() => {
    if (!load) return;
    let alive = true;
    void loadWidgets().then(async (twttr) => {
      const el = target.current;
      if (!alive || !el || !twttr?.widgets || el.childElementCount > 0) return;
      const drawn = await twttr.widgets.createTweet(statusId, el, { dnt: true, theme: "dark", lang: "pt", conversation: "none" });
      if (alive && drawn) setEmbedded(true);
    });
    return () => {
      alive = false;
    };
  }, [load, statusId]);

  const posted = block.postedAt ? dateFmt.format(new Date(block.postedAt)) : null;

  return (
    <figure className="my-4 flex flex-col gap-2">
      <div ref={target} className="[&>*]:mx-auto" />
      {embedded ? null : (
        <blockquote className="flex flex-col gap-3 rounded-[4px] border border-line bg-surface px-5 py-4">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
            <b className="font-bold text-text">{block.authorName}</b>
            <span className="font-mono text-xs text-dim">@{block.authorHandle}</span>
            {posted ? (
              <time dateTime={block.postedAt} className="font-mono text-xs text-dim">
                {posted}
              </time>
            ) : null}
          </p>
          <p className="text-[16px] leading-[1.6] whitespace-pre-line text-text-2">{block.text}</p>
          <p className="flex flex-wrap items-center gap-4 font-mono text-xs text-dim">
            {load ? null : consent === "unknown" ? null : (
              <button
                type="button"
                onClick={() => setClicked(true)}
                className="cursor-pointer rounded-[2px] border border-line-2 px-3 py-1.5 tracking-[0.06em] text-text-2 uppercase hover:border-text hover:text-text"
              >
                Carregar post
              </button>
            )}
            {load ? null : (
              <a href={block.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                Abrir no X
              </a>
            )}
          </p>
        </blockquote>
      )}
      {load ? (
        <figcaption className="font-mono text-xs text-dim">
          Não carregou?{" "}
          <a href={block.url} target="_blank" rel="noopener noreferrer" className={LINK}>
            Abrir no X
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}
