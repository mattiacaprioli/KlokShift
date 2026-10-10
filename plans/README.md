# Piani e decisioni

## Timbratura senza turno — 2026-10-10

[UNPLANNED-CLOCK.md](UNPLANNED-CLOCK.md): chi è abilitato timbra anche senza un
turno pianificato; all'uscita nasce il turno «Fuori turno», da approvare.
Implementata in `20261010000000_unplanned_clock.sql`.

## Monetizzazione e dashboard personale — decisioni 2026-10-05

[MONETIZATION-AND-FOUNDER-DASHBOARD.md](MONETIZATION-AND-FOUNDER-DASHBOARD.md)
contiene l'inventario della monetizzazione attuale, il confronto con la chat
allegata e i concorrenti, le dipendenze e i blocchi M01–M11 con verifiche.
Le regole correnti approvate sono nella documentazione dedicata:

- [MONETIZATION.md](../docs/MONETIZATION.md): listino/capacità, prova di 30
  giorni, gratuità a vita, pausa/annuale, insoluti, archivio di 12 mesi, prezzi,
  rimborsi, spazio e assistenza.
- [FOUNDER-DASHBOARD.md](../docs/FOUNDER-DASHBOARD.md): area personale per
  aziende, utenti, sedi/organico, date, incassi, spese, concessioni e anomalie.

Pagamenti automatici dal web e dashboard essenziale sono richiesti prima dei
primi clienti paganti. **Paddle** è scelto; approvazione/configurazione,
compatibilità ATECO e procedura fiscale della partita IVA forfettaria
dichiarata, dettagli di conteggio/prova e validazione privacy restano aperti;
la quota iniziale di spazio va calibrata sui tester. Lo sviluppo è iniziato
con la fondazione additiva M03a, verificata nel banco locale; limiti operativi,
interfacce, checkout e rollout richiedono i blocchi successivi. Lo stato nel
piano distingue decisioni, codice implementato e verifiche completate.

## Audit 2026-10-04 — riferimento corrente

[AUDIT-2026-10-04.md](AUDIT-2026-10-04.md) contiene l'audit aggiornato al commit
`d4ed077`, inclusa la rimozione intenzionale delle recensioni. Riporta 14
interventi B01–B14 con evidenze, ordine, dipendenze, stato, passaggi operativi,
regressioni e condizioni di arresto, oltre a un prompt per il modello esecutore.

Partire da B01 (configurazione dell'artifact pubblicato), poi seguire l'ordine
pratico nel documento. Nessuna correzione al prodotto applicata durante l'audit.
I vecchi A13–A15 mantengono le verifiche esterne pendenti: B14 le richiama senza
duplicarle. Aggiornare la tabella di stato del nuovo documento dopo ogni blocco.

## Audit 2026-09-22

Il documento completo è [AUDIT-2026-09-22.md](AUDIT-2026-09-22.md).

Contiene evidenze, verifiche eseguite, limiti dell'audit e piani di intervento numerati. È stato preparato sul commit `5b0b1b9`; nessuna correzione al prodotto è stata applicata durante l'audit.

Eseguire un intervento alla volta, aggiornando la tabella di stato nel documento. I controlli preliminari e le condizioni di arresto sono parte del piano. Non applicare migrazioni alla produzione durante l'esecuzione locale.

## Ore, assenze e maggiorazioni

[HOURS-ABSENCES-ADJUSTMENTS.md](HOURS-ABSENCES-ADJUSTMENTS.md) conserva la
decisione di prodotto del 2026-09-24: separazione fra ore lavorate, ore
riconosciute di assenza e maggiorazioni, modello proposto, ordine di
implementazione e confini rispetto al calcolo paghe.
