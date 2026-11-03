import { Card } from "@/components/ui/Card";

/** What a visitor sees of a private profile (the name only). */
export function PrivateProfile({ displayName }: { displayName: string }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <span className="tk-lbl">Personagem</span>
      <h1 className="mt-1.5 text-3xl leading-none font-black font-stretch-[125%] tracking-[-0.035em] break-words uppercase">
        {displayName}
      </h1>
      <p className="mt-4 text-muted">Este perfil é privado.</p>
    </Card>
  );
}

export function SectionSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-6">
      <div className="h-[88px] animate-pulse bg-surface tk-cut" />
      <div className="h-[420px] animate-pulse bg-surface tk-cut" />
    </div>
  );
}
