import { CONTACT_EMAIL, CONTACT_IS_PLACEHOLDER } from "@/lib/legal/contact";

/** The contact address, flagged while it is still a placeholder. */
export function ContactEmail({ subject }: { subject?: string }) {
  const href = `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return (
    <>
      <a href={href}>{CONTACT_EMAIL}</a>
      {CONTACT_IS_PLACEHOLDER ? (
        <strong> (endereço provisório: o canal definitivo será publicado antes do lançamento)</strong>
      ) : null}
    </>
  );
}
