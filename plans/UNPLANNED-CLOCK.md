# Timbratura senza turno

> **Decisione di prodotto e implementazione — 2026-10-10.** Migration
> `20261010000000_unplanned_clock.sql`, suite `supabase/tests/rls/029_unplanned_clock.sql`.
> Completa le timbrature (`20260924000000_shift_clock.sql`) e
> [HOURS-ABSENCES-ADJUSTMENTS.md](HOURS-ABSENCES-ADJUSTMENTS.md).

## Il caso

Alcune persone non hanno turni pianificati, oppure lavorano spesso fuori dal
planning (inventario, eventi, sostituzioni decise all'ultimo). Finora potevano
timbrare solo dentro un'assegnazione, quindi le loro ore non esistevano.

## La regola

> **La timbratura senza turno fa nascere un turno a posteriori, da approvare.**

Non c'è una seconda fonte di ore lavorate: tutta la catena (riepilogo,
export, sovrapposizioni con le assenze, maggiorazioni future) legge
`shift_assignments`. Una tabella di ore separata avrebbe obbligato a duplicarla.

Lo fanno così anche Planday (il turno extra compare nel planning dopo
l'approvazione) e Combo (il turno «Non planifié» compare all'uscita).
RotaCloud e Shiftee tengono un record separato, e Shiftee mostra il costo di
quella scelta: assenze finte da ricollegare a mano.

## Come funziona

1. **Abilitazione per persona e per sede** — `venue_members.clock_unplanned`,
   spenta di default, la accende chi ha «Ore» dalla scheda di organico. Vale
   solo con il metodo «Timbratura dall'app»: con Manuale non c'è niente da
   timbrare. Spegnerla non chiude un'entrata già aperta.
2. **Entrata** (`clock_punch_unplanned`) — crea una `shift_clock_records` con
   `shift_id` nullo, con mansione facoltativa (chiesta solo a chi ne ha più
   d'una) e nota facoltativa. Viene rifiutata se:
   - c'è un turno pianificato in corso o che attacca entro un'ora
     (`clock_planned_shift`): si timbra quello;
   - c'è già un'entrata aperta dello stesso account, in qualunque sede o
     azienda (`clock_already_open`).
3. **Uscita** — chiude la timbratura e crea, nella stessa transazione, il turno
   `Fuori turno` (`shifts.unplanned = true`) con gli orari al minuto,
   un'assegnazione confermata con `hours_source = 'clock_expected'` e il
   collegamento della timbratura. Le ore restano **da approvare**: si approva
   con il flusso normale (`approve_clock_record`), mai d'ufficio.
4. **Oltre 16 ore** il professionista non chiude più da sé
   (`clock_open_too_long`). L'uscita la registra chi ha «Ore» con
   `close_unplanned_clock`: è una correzione con motivo, e l'uscita originale
   resta vuota nell'audit.
5. **Entrata per errore** — `void_unplanned_clock` (aperta) o
   `void_clock_record` (già diventata turno). Nel secondo caso viene tolto anche
   il turno, che esisteva solo per quella timbratura. Il record annullato resta.

## Visibilità e notifiche

- Chi gestisce vede le entrate aperte in «Chi lavora oggi» (app e dashboard) con
  l'etichetta «Fuori turno». Chi ha «Ore» può registrare l'uscita o annullare.
- I colleghi vedono il turno nel planning (`get_staff_planning`) **solo dopo
  l'approvazione**.
- Nessuna notifica di «turno assegnato» o «turno revocato» per i turni nati da
  una timbratura (`app.unplanned_clock`, come `app.staff_exit`). Chi gestisce
  vede il turno tra le timbrature da verificare, senza un avviso per ogni
  entrata.

## Limiti noti

- Correggere gli orari della timbratura non sposta l'orario del turno: le ore
  vengono dalla timbratura, il turno conserva gli orari timbrati in origine.
- Il professionista non vede in tempo reale che chi gestisce ha chiuso la sua
  entrata: la Home si aggiorna al pull-to-refresh o alla riapertura.
- QR e posizione restano non disponibili come per i turni pianificati.
- **Contratti a chiamata (intermittenti):** di norma la chiamata va comunicata
  prima dell'inizio del lavoro. La timbratura senza turno non sostituisce quella
  comunicazione: da verificare con il consulente prima di abilitarla a chi ha
  quel contratto.
