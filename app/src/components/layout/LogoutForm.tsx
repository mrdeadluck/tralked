/** "Sair": a plain POST form, so logout works without JavaScript. */
export function LogoutForm({ className, buttonClassName }: { className?: string; buttonClassName?: string }) {
  return (
    <form action="/api/auth/logout" method="post" className={className}>
      <button type="submit" className={buttonClassName}>
        Sair
      </button>
    </form>
  );
}
