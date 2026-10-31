"use client";

import { useId, useState, type FormEvent } from "react";
import { subscribeNewsletterAction } from "@/lib/newsletter/actions";

export function Newsletter() {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState<{ email: string; delivery: "sent" | "registered" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorId = useId();

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

  return (
    <section
      aria-labelledby="newsletter-title"
      className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 rounded-[4px] bg-acc p-[22px] text-bg sm:p-8"
    >
      <div className="flex flex-[1_1_320px] flex-col gap-2.5">
        <h2
          id="newsletter-title"
          className="text-[clamp(26px,3vw,38px)] leading-none font-black font-stretch-[120%] tracking-[-0.035em]"
        >
          As principais notícias e guias da semana no seu e-mail
        </h2>
      </div>
      {subscribed !== null ? (
        <p role="status" className="flex-[1_1_360px] text-lg font-extrabold">
          {subscribed.delivery === "sent"
            ? `Quase lá! Enviamos um link de confirmação para ${subscribed.email}. A inscrição só vale depois que você confirmar por ele.`
            : `Inscrição registrada para ${subscribed.email}. Assim que o envio de e-mails estiver ativo, você recebe um link para confirmar.`}
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
