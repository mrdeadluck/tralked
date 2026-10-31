type ProgressBarProps = {
  /** 0..100 */
  value: number;
  label?: string;
};

export function ProgressBar({ value, label }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className="h-[3px] overflow-hidden rounded-[2px] bg-track"
    >
      <i
        className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
