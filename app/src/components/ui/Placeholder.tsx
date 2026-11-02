type PlaceholderProps = {
  /** Accessible name of the empty frame (never printed on it). */
  label: string;
  /** Valor CSS de aspect-ratio. Padrão: "16 / 10". */
  ratio?: string;
};

/**
 * Striped frame for an image that does not exist yet. It never prints a debug label ("[ capa: … ]")
 * on the page: game covers go through `CoverArt`, which falls back to generated art with the name.
 */
export function Placeholder({ label, ratio = "16 / 10" }: PlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={label}
      style={{ aspectRatio: ratio, backgroundImage: "var(--stripes)" }}
      className="relative overflow-hidden rounded-[3px]"
    />
  );
}
