import { EMBLEM, WORDMARK } from "./marks";

type LogoProps = {
  /** 44: cabeçalho (com tagline). 34: rodapé (compacto). */
  size?: 44 | 34;
};

/** Escudo com o monograma T, no acento. */
export function Emblem({ size, className = "" }: { size: number; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${EMBLEM.width} ${EMBLEM.height}`}
      height={size}
      width={Math.round((size * EMBLEM.width) / EMBLEM.height)}
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      <path d={EMBLEM.d} fill="var(--acc)" />
    </svg>
  );
}

/** Logotipo "TRALKED": letras na cor do texto (currentColor), o K no acento (ou em `--wordmark-k`). */
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
      <path d={WORDMARK.k} fill="var(--wordmark-k, var(--acc))" />
    </svg>
  );
}

export function Logo({ size = 44 }: LogoProps) {
  const full = size === 44;
  return (
    <span className="flex flex-none items-center gap-3 text-text">
      <Emblem size={size} />
      <span className="flex flex-col gap-[7px]">
        <Wordmark height={full ? 20 : 18} label="Tralked" />
        {full ? (
          // On narrow phones the tagline would push the account and menu buttons to a second row.
          <span className="font-mono text-[9.5px] tracking-[0.18em] text-dim uppercase max-[479px]:hidden">
            Feito por pessoas que amam jogar
          </span>
        ) : null}
      </span>
    </span>
  );
}
