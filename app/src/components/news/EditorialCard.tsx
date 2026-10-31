export function EditorialCard() {
  return (
    <div className="flex flex-col gap-3.5 rounded-[4px] bg-text p-6 text-bg">
      <h3 className="text-[26px] leading-[1.02] font-black font-stretch-[115%] tracking-[-0.03em] text-balance">
        Feito pela redação, vigiado por você
      </h3>
      <p className="text-[14px] leading-snug">
        Cada notícia diz quem escreveu: alguém da redação ou um robô. Achou um erro? Comente ou denuncie na própria página.
      </p>
    </div>
  );
}
