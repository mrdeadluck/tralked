type LogoProps = {
  /** 44: cabeçalho (com tagline). 34: rodapé (compacto). */
  size?: 44 | 34;
};

/** Símbolo Badge: quadrado acento com o canto inferior direito cortado e um ✓ escuro. */
function BadgeMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 44 44"
      width={size}
      height={size}
      aria-hidden="true"
      className="flex-none"
    >
      <path d="M0 0H44V31.68L31.68 44H0Z" fill="var(--acc)" />
      <path
        d="M11.5 22.5 L19 30 L32.5 14.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="7"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Logo({ size = 44 }: LogoProps) {
  const full = size === 44;
  return (
    <span className="flex flex-none items-center gap-3 text-text">
      <BadgeMark size={size} />
      <span className="flex flex-col gap-[5px]">
        <b
          className={`leading-none font-black font-stretch-[125%] tracking-[-0.03em] ${
            full ? "text-[25px]" : "text-[22px]"
          }`}
        >
          GAME<i className="text-acc not-italic">LOG</i>
        </b>
        {full ? (
          <span className="font-mono text-[9.5px] tracking-[0.18em] text-dim uppercase">
            Feito por pessoas que amam jogar
          </span>
        ) : null}
      </span>
    </span>
  );
}
