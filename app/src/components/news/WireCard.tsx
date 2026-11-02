import Link from "next/link";
import type { ReactNode } from "react";
import { GameArt } from "@/components/art/GameArt";
import { Wordmark } from "@/components/brand/Logo";
import { isSafeHref } from "@/lib/content/url";
import type { WireItem } from "@/lib/queries/news";

/*
 * One card of the "Em circulação" wire, in the five editorial variants of
 * preview/tralked-jogo.html (papel, bloco de acento, nova////, retrato P&B, escuro).
 * Styles live in NewsWire's stylesheet (`tkw-*` classes).
 */

function Brand() {
  return (
    <span className="tkw-brand" aria-hidden="true">
      <Wordmark height={16} />
    </span>
  );
}

function Leader({ left, right }: { left: string; right: string }) {
  return (
    <div className="tkw-leader" aria-hidden="true">
      <span>{left}</span>
      <i />
      <span>{right}</span>
    </div>
  );
}

function CardArrow({ external }: { external?: boolean }) {
  return (
    <svg className="tkw-arrow" viewBox="0 0 16 16" aria-hidden="true">
      {external ? (
        <path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

function body(item: WireItem): ReactNode {
  const art = (w: number, h: number, light = false) => (
    <GameArt
      className="tkw-art"
      seed={item.seed}
      hues={item.hues}
      imageUrl={item.imageUrl}
      figure
      light={light}
      width={w}
      height={h}
      sizes="300px"
    />
  );

  switch (item.variant) {
    case "paper":
      return (
        <>
          <div className="tkw-hl">{item.title}</div>
          <div className="tkw-img">{art(440, 380, true)}</div>
          <Leader left={item.kicker} right={item.when} />
          <span className="tkw-meta" aria-hidden="true">
            {item.source}
          </span>
        </>
      );
    case "block":
      return (
        <>
          <div className="tkw-a1">
            <div className="tkw-hl">{item.title}</div>
          </div>
          <div className="tkw-a2" />
          <div className="tkw-a3">
            <Brand />
          </div>
          <i className="tkw-mark" />
          <div className="tkw-a4">
            {(item.items ?? []).map((row, i) => (
              <div key={i}>
                <b>{row.label}</b>
                <Leader left={item.kicker} right={row.date} />
              </div>
            ))}
          </div>
        </>
      );
    case "newp":
      return (
        <>
          <div className="tkw-top">
            <span className="tkw-thin" aria-hidden="true">{item.thin ?? "nova////\nnotícia"}</span>
            <span className="tkw-hl">{item.title}</span>
          </div>
          <div className="tkw-img">
            {art(600, 520)}
            <span className="tkw-meta" aria-hidden="true">
              {item.source} · {item.when}
            </span>
            <Brand />
          </div>
        </>
      );
    case "portrait":
      return (
        <>
          {art(600, 740, true)}
          <span className="tkw-tag">{item.title}</span>
          <span className="tkw-giant" aria-hidden="true">
            {item.giant ?? item.kicker}
          </span>
        </>
      );
    case "dark":
      return (
        <>
          <div className="tkw-hl">{item.title}</div>
          <div className="tkw-img">
            {art(600, 480)}
            <span className="tkw-meta" aria-hidden="true">
              {item.kicker} · {item.source} · {item.when}
            </span>
          </div>
        </>
      );
  }
}

export function WireCard({ item, hidden = false }: { item: WireItem; hidden?: boolean }) {
  // Never render an unsafe href (e.g. a javascript: link from a feed).
  if (!isSafeHref(item.href, item.external)) return null;
  const common = {
    className: `tkw-card tkw-${item.variant}${hidden ? " tkw-copy" : ""}`,
    "aria-hidden": hidden || undefined,
    tabIndex: hidden ? -1 : undefined,
    draggable: false,
    "data-kicker": item.kicker,
    "data-title": item.title,
  };
  const content = (
    <>
      {body(item)}
      {/* The visible meta is decorative per variant; this gives every card the same spoken summary. */}
      <span className="sr-only">
        {`. ${item.kicker}, ${item.source}, ${item.when}${item.external ? " (abre em nova aba)" : ""}`}
      </span>
      <CardArrow external={item.external} />
    </>
  );

  return item.external ? (
    <a {...common} href={item.href} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    <Link {...common} href={item.href} prefetch={false}>
      {content}
    </Link>
  );
}
