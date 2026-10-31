import { Container } from "../ui/Container";
import { Logo } from "../ui/Logo";
import { t } from "../content";

/*
 * Come nei siti dei concorrenti: in alto le pagine del sito e il recapito, in
 * fondo una riga piccola con le pagine legali accanto al copyright.
 *
 * Le pagine legali sono file statici serviti accanto a questa pagina
 * (`public/`), non rotte React: i loro URL stanno anche nell'app, nella scheda
 * dello store e nella revisione di Paddle, quindi non devono dipendere dal
 * bundle per aprirsi.
 */
const columnLink =
  "focus-gold rounded py-2 text-t2 transition-colors hover:text-gold";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-bg-card">
      <Container className="flex flex-col gap-10 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-t3">{t.footer.tagline}</p>
        </div>

        <div className="flex gap-16 text-sm">
          <nav aria-label={t.footer.productLabel} className="flex flex-col">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-t4">
              {t.footer.productLabel}
            </p>
            {t.nav.links.map((link) => (
              <a key={link.href} href={link.href} className={columnLink}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-t4">
              {t.footer.contactLabel}
            </p>
            <a href={`mailto:${t.footer.email}`} className={columnLink}>
              {t.footer.email}
            </a>
          </div>
        </div>
      </Container>

      <Container className="flex flex-col gap-4 border-t border-border py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs text-t4">
          © {year} {t.brand.name} · {t.footer.owner} · {t.footer.rights}
        </p>
        {/* `py-1` e lo spazio fra le righe: sul telefono vanno a capo e il dito
            deve poterli distinguere. */}
        <nav aria-label={t.footer.legalLabel} className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {t.footer.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-gold rounded py-1 text-t3 transition-colors hover:text-gold"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </Container>
    </footer>
  );
}
