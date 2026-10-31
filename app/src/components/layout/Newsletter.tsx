"use client";

import { useState, type FormEvent } from "react";

type NewsletterProps = {
  /** Chamado com o e-mail ao enviar o formulário (ainda sem backend). */
  onSubscribe?: (email: string) => void | Promise<void>;
};

export function Newsletter({ onSubscribe }: NewsletterProps) {
  const [email, setEmail] = useState("");
  const [subscribedEmail, setSubscribedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await onSubscribe?.(email);
      setSubscribedEmail(email);
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
        <span className="font-mono text-[11px] font-bold tracking-[0.14em]">
          NEWSLETTER
        </span>
        <h2
          id="newsletter-title"
          className="text-[clamp(26px,3vw,38px)] leading-none font-black font-stretch-[120%] tracking-[-0.035em]"
        >
          As principais notícias e guias da semana no seu e-mail
        </h2>
      </div>
      {subscribedEmail !== null ? (
        <p role="status" className="flex-[1_1_360px] text-lg font-extrabold">
          Pronto! Confirme a inscrição em {subscribedEmail}.
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex flex-[1_1_360px] flex-wrap gap-2"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="seu@email.com"
            aria-label="Seu e-mail"
            className="h-[52px] flex-[1_1_200px] rounded-[2px] border-2 border-bg bg-transparent px-4 text-base text-bg outline-0 placeholder:text-bg/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg"
          />
          <button
            type="submit"
            disabled={pending}
            className="h-[52px] cursor-pointer rounded-[2px] border-0 bg-bg px-[22px] font-mono text-xs font-bold tracking-[0.1em] text-text hover:bg-[#23252c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            INSCREVER →
          </button>
        </form>
      )}
    </section>
  );
}
