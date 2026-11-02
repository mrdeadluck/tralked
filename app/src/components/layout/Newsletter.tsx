"use client";

import { useId, useState, type FormEvent } from "react";
import { subscribeNewsletterAction } from "@/lib/newsletter/actions";

type Subscribed = { email: string; delivery: "sent" | "registered" };

/*
 * The news pages (home, /noticias, articles) end on the lime block, rendered by the page itself;
 * the footer's one-line version hides on a page that carries the block (CSS :has, see Footer).
 * Nothing branches on the pathname: on Vercel the home's server render did not see "/" and drew
 * the line while the browser drew the block, a hydration mismatch (React error #418).
 */

function useSubscribe() {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState<Subscribed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await subscribeNewsletterAction({ email });
      if (result.ok) setSubscribed({ email: result.email, delivery: result.delivery });
      else setError(result.error);
    } catch {
      setError("Não deu para inscrever agora. Tente de novo em alguns minutos.");
    } finally {
      setPending(false);
    }
  }

  return { email, setEmail, subscribed, error, pending, handleSubmit };
}

function doneMessage({ email, delivery }: Subscribed): string {
  return delivery === "sent"
    ? `Quase lá! Enviamos um link de confirmação para ${email}. A inscrição só vale depois que você confirmar por ele.`
    : `O envio de e-mails do Tralked está desativado no momento, então não deu para mandar o link de confirmação para ${email}. O endereço ficou registrado; inscreva-se de novo mais tarde para receber o link.`;
}

export function Newsletter({ variant = "block" }: { variant?: "block" | "line" }) {
  const { email, setEmail, subscribed, error, pending, handleSubmit } = useSubscribe();
  const errorId = useId();
  const titleId = useId();

  if (variant === "line") {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-divider pb-8"
      >
        <h2 id={titleId} className="text-[15px] font-bold text-text">
          Newsletter semanal <span className="font-normal text-muted">· as principais notícias e guias, um e-mail por semana</span>
        </h2>
        {subscribed !== null ? (
          <p role="status" className="max-w-[60ch] text-[14px] text-text-2">
            {doneMessage(subscribed)}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full max-w-[440px] flex-col gap-1.5">
            <div className="flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu@email.com"
                aria-label="Seu e-mail"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-11 min-w-0 flex-1 rounded-[2px] border border-line-2 bg-surface-2 px-3.5 text-base text-text outline-0 transition-colors duration-150 focus-visible:border-acc sm:text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="h-11 cursor-pointer rounded-[2px] border border-acc px-4 font-mono text-xs font-bold tracking-[0.1em] text-acc uppercase transition-colors duration-150 hover:bg-acc hover:text-bg disabled:cursor-wait disabled:opacity-60"
              >
                {pending ? "Enviando…" : "Inscrever"}
              </button>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-[13.5px] text-nin">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </section>
    );
  }

  return (
    <section
      data-newsletter-block=""
      aria-labelledby={titleId}
      className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 rounded-[4px] bg-acc p-[22px] text-bg sm:p-8"
    >
      <div className="flex flex-[1_1_320px] flex-col gap-2.5">
        <h2
          id={titleId}
          className="text-[clamp(26px,3vw,38px)] leading-none font-black font-stretch-[120%] tracking-[-0.035em]"
        >
          As principais notícias e guias da semana no seu e-mail
        </h2>
      </div>
      {subscribed !== null ? (
        <p role="status" className="flex-[1_1_360px] text-lg font-extrabold">
          {doneMessage(subscribed)}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-[1_1_360px] flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="seu@email.com"
              aria-label="Seu e-mail"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="h-[52px] flex-[1_1_200px] rounded-[2px] border-2 border-bg bg-transparent px-4 text-base text-bg outline-0 placeholder:text-bg/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg"
            />
            <button
              type="submit"
              disabled={pending}
              className="h-[52px] cursor-pointer rounded-[2px] border-0 bg-bg px-[22px] font-mono text-xs font-bold tracking-[0.1em] text-text hover:bg-[#23252c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "ENVIANDO…" : "INSCREVER →"}
            </button>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-[14px] font-bold">
              {error}
            </p>
          ) : null}
          <p className="text-[12.5px] text-bg/75">
            Um e-mail por semana, só depois que você confirmar pelo link que enviamos.
          </p>
        </form>
      )}
    </section>
  );
}
