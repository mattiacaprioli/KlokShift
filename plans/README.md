# Piani e decisioni

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
