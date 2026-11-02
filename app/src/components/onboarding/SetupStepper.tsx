import Link from "next/link";

type SetupStepperProps = {
  /** Some platform is connected: step 2 is done and step 3 opens the sheet. */
  connected: boolean;
  /** The player's sheet. */
  sheetHref: string;
};

const CHECK = (
  <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
    <path d="m2.5 6.5 2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
  </svg>
);

/**
 * After sign-up, on Conexões: the three steps of the promise made on /cadastrar, with the account
 * already done. Ordered list; the step to do now carries aria-current="step".
 */
export function SetupStepper({ connected, sheetHref }: SetupStepperProps) {
  const steps = [
    { label: "Conta criada", done: true },
    { label: "Conecte uma plataforma", done: connected },
    { label: "Veja o seu nível", done: false },
  ];
  const currentIndex = connected ? 2 : 1;
  return (
    <nav aria-label="Primeiros passos" className="rounded-[3px] border border-line bg-surface px-4 py-3.5 sm:px-5">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        {steps.map((step, i) => {
          const current = i === currentIndex;
          const badge = (
            <span
              aria-hidden="true"
              className={`grid size-6 flex-none place-items-center rounded-[2px] font-mono text-xs font-bold ${
                step.done ? "bg-acc/15 text-acc" : current ? "bg-acc text-bg" : "border border-line-2 text-dim"
              }`}
            >
              {step.done ? CHECK : i + 1}
            </span>
          );
          const text = (
            <span className={`text-[14px] ${current ? "font-bold text-text" : step.done ? "text-text-2" : "text-muted"}`}>
              {step.label}
              {step.done ? <span className="sr-only"> (feito)</span> : null}
            </span>
          );
          return (
            <li key={step.label} aria-current={current ? "step" : undefined} className="flex items-center gap-3">
              {i === 2 && connected ? (
                <Link
                  href={sheetHref}
                  className="inline-flex min-h-11 items-center gap-2.5 rounded-[2px] text-acc underline-offset-4 hover:underline"
                >
                  {badge}
                  <span className="text-[14px] font-bold">Veja o seu nível →</span>
                </Link>
              ) : (
                <span className="inline-flex min-h-8 items-center gap-2.5">
                  {badge}
                  {text}
                </span>
              )}
              {i < steps.length - 1 ? (
                <span aria-hidden="true" className={`hidden h-px w-8 sm:block ${step.done ? "bg-acc/50" : "bg-line-2"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
