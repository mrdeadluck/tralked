import { Fragment, type CSSProperties, type ReactNode } from "react";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { Gallery } from "@/components/content/Gallery";
import { XPostEmbed } from "@/components/content/XPostEmbed";
import { rarityTier, xpForAchievement } from "@/lib/engine/xp";
import { sizedImage } from "@/lib/images/sized";
import {
  achievementKey,
  INLINE_SPOILER,
  isSafeHttpUrl,
  type AchievementCardData,
  type CalloutTone,
  type ContentBlock,
} from "./schema";

export { achievementKey, type AchievementCardData };

/*
 * The single renderer for ContentBlock[] (news now, guides and the admin preview later).
 * Everything is rendered as React elements: no HTML string ever reaches the DOM.
 */

const LINK_AT = /\[([^\]\n]+)\]\(([^)\s]+)\)/y;
const BOLD_AT = /\*\*(?=\S)(.+?)\*\*/y;
const ITALIC_AT = /\*(?=[^\s*])([^*\n]+?)\*/y;
/** `||spoiler||` (walkthroughs only). */
const SPOILER_AT = new RegExp(INLINE_SPOILER.source, "y");

type InlineOptions = {
  /**
   * Renders an inline `||spoiler||` span from its inner text. Only walkthrough pages pass it;
   * without it `||` stays literal text, as it always was for news and classic guides.
   */
  spoiler?: (inner: string) => ReactNode;
};

/**
 * Restricted inline markup to React nodes: **bold**, *italic* and [label](http(s) url), plus
 * `||spoiler||` spans when `options.spoiler` is given. Anything else, including a link with an
 * unsafe target, stays literal text.
 */
export function inlineMarkup(text: string, options: InlineOptions = {}): ReactNode[] {
  return parseInline(text, "i", options);
}

function parseInline(text: string, keyPrefix: string, options: InlineOptions): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = "";
  };
  const at = (re: RegExp) => {
    re.lastIndex = i;
    return re.exec(text);
  };

  while (i < text.length) {
    const ch = text[i];
    const key = `${keyPrefix}.${out.length}`;
    if (ch === "|" && options.spoiler) {
      const m = at(SPOILER_AT);
      if (m) {
        flush();
        out.push(<Fragment key={key}>{options.spoiler(m[1])}</Fragment>);
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const m = at(LINK_AT);
      if (m) {
        flush();
        const [, label, href] = m;
        out.push(
          isSafeHttpUrl(href) ? (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-acc underline decoration-1 underline-offset-[3px] hover:decoration-2"
            >
              {parseInline(label, key, options)}
            </a>
          ) : (
            label
          ),
        );
        i += m[0].length;
        continue;
      }
    } else if (ch === "*") {
      const bold = at(BOLD_AT);
      if (bold) {
        flush();
        out.push(
          <strong key={key} className="font-bold text-text">
            {parseInline(bold[1], key, options)}
          </strong>,
        );
        i += bold[0].length;
        continue;
      }
      const italic = at(ITALIC_AT);
      if (italic) {
        flush();
        out.push(<em key={key}>{parseInline(italic[1], key, options)}</em>);
        i += italic[0].length;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

const TEXT = "text-[17px] leading-[1.7] text-text-2";

const CALLOUT_LABEL: Record<CalloutTone, string> = {
  info: "Saiba mais",
  aviso: "Atenção",
  spoiler: "Spoiler",
};

const CALLOUT_COLOR: Record<CalloutTone, string> = {
  info: "var(--acc)",
  aviso: "var(--r-lendario)",
  spoiler: "var(--r-epico)",
};

const pct = (p: number) => `${String(Math.round(p * 10) / 10).replace(".", ",")}%`;
const xpFormat = new Intl.NumberFormat("pt-BR");

function AchievementCard({
  apiName,
  data,
}: {
  apiName: string;
  data: AchievementCardData | undefined;
}) {
  if (!data) {
    return (
      <div className="rounded-[4px] border border-line bg-surface px-5 py-4 font-mono text-xs text-dim">
        Conquista {apiName}
      </div>
    );
  }
  const tier = data.globalPct === null ? null : rarityTier(data.globalPct);
  return (
    <div
      style={{ "--c": tier ? RARITY_COLOR[tier] : "var(--muted)" } as CSSProperties}
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-[4px] border border-line bg-surface px-5 py-4"
    >
      <span
        aria-hidden="true"
        className="size-11 rounded-[3px] border border-(--c) bg-[repeating-linear-gradient(135deg,#1c1e24_0_4px,#24262d_4px_8px)]"
      />
      <span className="flex min-w-0 flex-col gap-1">
        <b className="text-[16px] leading-tight font-extrabold text-text">{data.name}</b>
        {data.description ? (
          <span className="text-[14px] leading-snug text-muted">{data.description}</span>
        ) : null}
        <span className="font-mono text-xs tracking-[0.06em] text-dim uppercase">
          {data.gameName}
          {tier && data.globalPct !== null ? (
            <>
              {" · "}
              <span className="text-(--c)">{RARITY_LABEL[tier]}</span> · {pct(data.globalPct)} dos jogadores
            </>
          ) : null}
        </span>
      </span>
      <span className="text-right font-mono text-[13px] font-bold text-acc">
        +{xpFormat.format(xpForAchievement(data.globalPct))}
        <small className="block text-xs font-normal text-dim">XP</small>
      </span>
    </div>
  );
}

function Block({
  block,
  achievements,
}: {
  block: ContentBlock;
  achievements: Record<string, AchievementCardData>;
}) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 className="mt-12 mb-1 text-[26px] leading-[1.1] font-extrabold font-stretch-[110%] tracking-[-0.02em]">
          {block.text}
        </h2>
      ) : (
        <h3 className="mt-9 mb-1 text-xl leading-[1.15] font-bold">{block.text}</h3>
      );
    case "paragraph":
      return <p className={TEXT}>{inlineMarkup(block.text)}</p>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1 marker:text-dim">
          {inlineMarkup(item)}
        </li>
      ));
      return block.ordered ? (
        <ol className={`list-decimal pl-6 ${TEXT} [&>li+li]:mt-1.5`}>{items}</ol>
      ) : (
        <ul className={`list-disc pl-6 ${TEXT} [&>li+li]:mt-1.5`}>{items}</ul>
      );
    }
    case "quote":
      return (
        <figure className="my-4 flex flex-col gap-3 border-l border-line-2 pl-6">
          <blockquote className="text-[22px] leading-[1.35] font-semibold tracking-[-0.01em] text-text">
            {inlineMarkup(block.text)}
          </blockquote>
          {block.author ? (
            <figcaption className="font-mono text-xs tracking-[0.06em] text-dim uppercase">
              {block.author}
            </figcaption>
          ) : null}
        </figure>
      );
    case "image": {
      // IGDB and Steam screenshots come at the column's size (shown whole: uncropped sizes). Guessed
      // thumbnails (SteamGridDB) need an onError fallback, which this server markup has not: kept as is.
      const sized = sizedImage(block.url, 720, "fit");
      const responsive = sized.srcSet && !sized.fallbacks;
      return (
        <figure className="my-4 flex flex-col gap-2">
          {/* External https image with mandatory alt and credit; next/image would need remotePatterns per host. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={responsive ? sized.src : block.url}
            srcSet={responsive ? sized.srcSet : undefined}
            sizes={responsive ? "(max-width: 760px) calc(100vw - 40px), 720px" : undefined}
            alt={block.alt}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[3px] bg-surface"
          />
          <figcaption className="font-mono text-xs text-dim">
            Crédito:{" "}
            {block.creditUrl ? (
              <a
                href={block.creditUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline decoration-1 underline-offset-[3px] hover:text-text-2"
              >
                {block.credit}
              </a>
            ) : (
              block.credit
            )}
          </figcaption>
        </figure>
      );
    }
    case "video":
      // Privacy-enhanced embed (youtube-nocookie.com), loaded only near the viewport, 16:9 at any width.
      return (
        <figure className="my-4 flex flex-col gap-2">
          <div className="aspect-video overflow-hidden rounded-[3px] bg-surface">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${block.youtubeId}`}
              title={block.title ? `Vídeo do YouTube: ${block.title}` : "Vídeo do YouTube"}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="size-full border-0"
            />
          </div>
          <figcaption className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs text-dim">
            {block.title ? <span>{block.title}</span> : null}
            <span>
              Não carregou?{" "}
              <a
                href={`https://www.youtube.com/watch?v=${block.youtubeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-[3px] hover:text-text-2"
              >
                Abrir no YouTube
              </a>
            </span>
          </figcaption>
        </figure>
      );
    case "post":
      return <XPostEmbed block={block} />;
    case "gallery":
      return <Gallery block={block} />;
    case "callout": {
      const style = { "--c": CALLOUT_COLOR[block.tone] } as CSSProperties;
      const label = (
        <span className="inline-flex items-center gap-2 font-mono text-xs font-bold tracking-[0.12em] text-(--c) uppercase before:size-1.5 before:bg-(--c) before:content-['']">
          {CALLOUT_LABEL[block.tone]}
        </span>
      );
      if (block.tone === "spoiler") {
        return (
          <details
            style={style}
            className="group my-2 rounded-[4px] border border-line bg-surface px-5 py-4"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              {label}
              <span className="font-mono text-xs tracking-[0.08em] text-text-3 uppercase group-open:hidden">
                Mostrar
              </span>
              <span className="hidden font-mono text-xs tracking-[0.08em] text-text-3 uppercase group-open:inline">
                Esconder
              </span>
            </summary>
            <p className={`mt-3 ${TEXT}`}>{inlineMarkup(block.text)}</p>
          </details>
        );
      }
      return (
        <aside
          style={style}
          aria-label={CALLOUT_LABEL[block.tone]}
          className="my-2 flex flex-col gap-2 rounded-[4px] border border-line bg-surface px-5 py-4"
        >
          {label}
          <p className="text-[16px] leading-[1.65] text-text-2">{inlineMarkup(block.text)}</p>
        </aside>
      );
    }
    case "table":
      return (
        <div
          role="region"
          aria-label="Tabela"
          tabIndex={0}
          className="my-2 overflow-x-auto rounded-[4px] border border-line"
        >
          <table className="w-full border-collapse text-left text-[15px] tabular-nums">
            <thead className="bg-surface">
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-b border-line-2 px-4 py-2.5 font-mono text-xs font-bold tracking-[0.08em] text-text-3 uppercase"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-divider last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-4 py-2.5 text-text-2">
                      {inlineMarkup(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "achievement":
      return (
        <AchievementCard
          apiName={block.apiName}
          data={achievements[achievementKey(block.platform, block.apiName)]}
        />
      );
    case "divider":
      return <hr className="my-6 border-0 border-t border-line" />;
  }
}

/** Renders validated ContentBlock[] (see `parseStoredBlocks`). */
export function Blocks({
  blocks,
  achievements = {},
}: {
  blocks: ContentBlock[];
  /** Resolved `achievement` blocks, keyed by `achievementKey(platform, apiName)`. */
  achievements?: Record<string, AchievementCardData>;
}) {
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      {blocks.map((block, i) => (
        <Block key={i} block={block} achievements={achievements} />
      ))}
    </div>
  );
}
