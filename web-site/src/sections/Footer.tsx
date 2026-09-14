import { Container } from "../ui/Container";
import { Logo } from "../ui/Logo";
import { t } from "../content";

/*
 * Privacy ed eliminazione account sono file statici serviti accanto a questa
 * pagina (`public/`), non rotte React: i loro URL stanno anche nell'app e nella
 * scheda dello store, quindi non devono dipendere dal bundle per aprirsi.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-bg-card">
      <Container className="flex flex-col gap-8 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-t3">{t.footer.tagline}</p>
        </div>

        <nav
          aria-label={t.footer.emailLabel}
          className="flex flex-col text-sm"
        >
          {/* `py-3` non è estetica: sul telefono questi link finiscono uno
              sotto l'altro e servono bersagli che il dito non sbagli. */}
          {t.footer.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-gold rounded py-3 text-t2 transition-colors hover:text-gold"
            >
              {link.label}
            </a>
          ))}
          <a
            href={`mailto:${t.footer.email}`}
            className="focus-gold rounded py-3 text-t2 transition-colors hover:text-gold"
          >
            {t.footer.emailLabel} · {t.footer.email}
          </a>
        </nav>
      </Container>

      <Container className="border-t border-border py-6">
        <p className="font-mono text-xs text-t4">
          © {year} {t.brand.name} · {t.footer.rights}
        </p>
      </Container>
    </footer>
  );
}
