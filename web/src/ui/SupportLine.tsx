import { SUPPORT_EMAIL, supportMailto } from "@/features/support/supportContent";

/**
 * «Serve aiuto?» per le pagine fuori dal menu (accesso, registrazione, invito,
 * prima azienda): è lì che chi è nuovo si blocca, e lì l'Aiuto non c'è.
 */
export function SupportLine({ className = "" }: { className?: string }) {
  if (!SUPPORT_EMAIL) return null;
  return (
    <p className={`text-center text-xs text-t4 ${className}`}>
      Serve aiuto? Scrivi a{" "}
      <a
        className="focus-gold font-medium text-t3 underline hover:text-gold"
        href={supportMailto(SUPPORT_EMAIL, { surface: "Dashboard web" })}
      >
        {SUPPORT_EMAIL}
      </a>
    </p>
  );
}
