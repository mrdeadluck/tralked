import { EMBLEM, WORDMARK } from "./marks";
import { SLOGAN } from "./slogan";

type LogoProps = {
  /** 44: cabeçalho (com tagline). 34: rodapé (compacto). */
  size?: 44 | 34;
};

/**
 * Monograma "TLK": T e L na cor do texto, K no acento. Com `size`, altura fixa em px;
 * sem `size`, a altura vem do `className` (ex. `h-9`) e a largura segue a proporção.
 */
export function Emblem({ size, className = "" }: { size?: number; className?: string }) {
  const ratio = `${EMBLEM.width} / ${EMBLEM.height}`;
  return (
    <svg
      viewBox={`0 0 ${EMBLEM.width} ${EMBLEM.height}`}
      {...(size
        ? { height: size, width: Math.round((size * EMBLEM.width) / EMBLEM.height) }
        : { style: { width: "auto", aspectRatio: ratio } })}
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      <path d={EMBLEM.t} fill="currentColor" />
      <path d={EMBLEM.l} fill="currentColor" />
      <path d={EMBLEM.k} fill="var(--acc)" />
    </svg>
  );
}

/** Logotipo "TRALKED": letras na cor do texto (currentColor), o L também (ou `--wordmark-l`), o K no acento (ou `--wordmark-k`). */
export function Wordmark({ height, className = "", label }: { height: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
      height={height}
      width={Math.round((height * WORDMARK.width) / WORDMARK.height)}
      className={`flex-none ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={WORDMARK.d} fill="currentColor" fillRule="evenodd" />
      <path d={WORDMARK.l} fill="var(--wordmark-l, currentColor)" />
      <path d={WORDMARK.k} fill="var(--wordmark-k, var(--acc))" />
    </svg>
  );
}

export function Logo({ size = 44 }: LogoProps) {
  const full = size === 44;
  return (
    // The monogram spans the whole text block: its top meets the top of TRALKED and its bottom the
    // bottom of the slogan (wordmark 20 + gap 7 + slogan 9.5 = 36.5 px), or of the wordmark alone when
    // the slogan is hidden (phones) or absent (footer).
    <span className="flex flex-none items-start gap-3 text-text">
      <Emblem className={full ? "h-[36.5px] max-[479px]:h-5" : "h-[18px]"} />
      <span className="flex flex-col gap-[7px]">
        <Wordmark height={full ? 20 : 18} label="Tralked" />
        {full ? (
          // On narrow phones the tagline would push the account and menu buttons to a second row.
          <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-dim uppercase max-[479px]:hidden">
            {SLOGAN}
          </span>
        ) : null}
      </span>
    </span>
  );
}
