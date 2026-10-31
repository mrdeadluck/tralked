import { loginHref } from "./format";

/** Shown when a logged-out visitor tries to save progress or vote. */
export function LoginNudge({ returnTo, className = "" }: { returnTo: string; className?: string }) {
  return (
    <p role="status" className={`font-mono text-[11px] tracking-[0.04em] ${className}`}>
      <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
        Entre com a Steam para salvar seu progresso
      </a>
    </p>
  );
}
