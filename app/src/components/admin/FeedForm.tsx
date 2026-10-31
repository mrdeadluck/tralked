"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { saveFeedAction } from "@/app/admin/feeds/actions";
import { NEWS_FEED_AREA_HINT, NEWS_FEED_AREA_LABEL, NEWS_FEED_AREAS, toNewsFeedArea, type NewsFeedArea } from "@/lib/news/areas";
import { HINT, INPUT, LABEL, SELECT, SMALL_BUTTON } from "./ui";

type Feed = { id: string; name: string; url: string; active: boolean; area: string };

/** Create (no `feed`) or edit an RSS feed. The URL must be https; the area decides what is kept. */
export function FeedForm({ feed, defaultArea = "GAMES" }: { feed?: Feed; defaultArea?: NewsFeedArea }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(feed?.name ?? "");
  const [url, setUrl] = useState(feed?.url ?? "");
  const [area, setArea] = useState<NewsFeedArea>(feed ? toNewsFeedArea(feed.area) : defaultArea);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    start(async () => {
      const result = await saveFeedAction({ ...(feed ? { id: feed.id } : {}), name, url, area, active: feed?.active ?? true });
      if (!result.ok) {
        setNotice({ ok: false, text: result.error, field: result.field });
        return;
      }
      setNotice({ ok: true, text: feed ? "Feed salvo." : "Feed adicionado." });
      if (!feed) {
        setName("");
        setUrl("");
      }
      router.refresh();
    });
  }

  const bad = (field: string) => (notice && !notice.ok && notice.field === field) || undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,180px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className={LABEL}>
            Nome da publicação
          </label>
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={bad("name")} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-area`} className={LABEL}>
            Área
          </label>
          <select
            id={`${id}-area`}
            value={area}
            onChange={(e) => setArea(toNewsFeedArea(e.target.value))}
            aria-describedby={`${id}-area-hint`}
            aria-invalid={bad("area")}
            className={SELECT}
          >
            {NEWS_FEED_AREAS.map((a) => (
              <option key={a} value={a}>
                {NEWS_FEED_AREA_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className={LABEL}>
            Endereço do feed RSS
          </label>
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://exemplo.com/feed.xml"
            aria-describedby={`${id}-url-hint`}
            aria-invalid={bad("url")}
            className={`${INPUT} font-mono text-[14px]`}
          />
          <span id={`${id}-url-hint`} className={HINT}>
            Só https. Guardamos título, link, fonte e data de cada notícia, nunca o texto.
          </span>
        </div>
      </div>
      <p id={`${id}-area-hint`} className={HINT}>
        {NEWS_FEED_AREA_HINT[area]}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${SMALL_BUTTON} h-11 border-acc text-acc hover:bg-acc hover:text-bg`}>
          {pending ? "Salvando…" : feed ? "Salvar feed" : "Adicionar feed"}
        </button>
        <p aria-live="polite" className="text-[14px]">
          {notice ? (
            <span role={notice.ok ? undefined : "alert"} className={notice.ok ? "text-acc" : "text-nin"}>
              {notice.text}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
