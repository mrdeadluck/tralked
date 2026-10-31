type PlaceholderProps = {
  label: string;
  /** Valor CSS de aspect-ratio. Padrão: "16 / 10". */
  ratio?: string;
};

export function Placeholder({ label, ratio = "16 / 10" }: PlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={label}
      style={{ aspectRatio: ratio, backgroundImage: "var(--stripes)" }}
      className="relative overflow-hidden rounded-[3px]"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-2.5 left-3 font-mono text-[10px] text-ph"
      >
        [ {label} ]
      </span>
    </div>
  );
}
