# Modelli di turno — 2026-10-16

Migration `20261016000200_shift_templates.sql`, suite
`supabase/tests/rls/032_shift_templates.sql`.

## Il problema

Ogni turno si riscriveva da zero: orari, pausa, fabbisogno per ruolo, note,
«chiedi conferma». «Duplica settimana» copia un periodo intero, ma non c'era
modo di riusare *un* turno tipo («Cena», «Pranzo sala», «Chiusura bar»).

## Decisioni

- **Cosa ricorda un modello**: nome, orari, pausa, fabbisogno per ruolo, note e
  «chiedi conferma». **Non** la data e **non** le persone: cambiano da un giorno
  all'altro, e una persona uscita dall'organico o assente non deve finire in un
  turno perché era in un modello vecchio.
- **Per sede**: il fabbisogno nomina `venue_roles` di quella sede. Lo vede e lo
  scrive chiunque abbia «Turni» su quella sede (titolare e collaboratori), da
  app e dashboard.
- **Da dove si salva**: dal form del nuovo turno e dal dettaglio di un turno
  esistente, anche passato o annullato («come venerdì scorso»). Il fuori turno
  no: non è stato pianificato.
- **Applicare un modello** riempie il form e lascia com'erano data, giorni
  ripetuti e persone scelte. Il nome del modello diventa il titolo del turno.
- **Stesso nome = stesso modello**: risalvare «cena» aggiorna «Cena» (il
  confronto ignora maiuscole e spazi ai bordi, e il form lo dice prima).
- **Al massimo 30 modelli per sede** (`template_limit`): oltre, una riga di chip
  non si legge più.
- **Eliminare un modello non tocca i turni** nati da lui: sono copie, non legami.
  Per lo stesso motivo un modello non si «aggiorna» nei turni già creati.
- **Ruoli archiviati**: restano nel modello e si scartano quando lo si applica
  (`applicableRoleTargets`). Il modello è un precompilato, non un vincolo.

## Implementazione

- **DB**: `shift_templates` (`role_targets` in jsonb `[{role_id, count}]`,
  count 1..99), lettura RLS `venues_where('shifts')` più la policy restrittiva
  d'archivio; scritture solo da `save_shift_template(venue, jsonb)` e
  `delete_shift_template(id)`, con `assert_workspace_operational`,
  `can(venue,'shifts')`, `assert_shift_break` e `assert_role_in_venue`.
- **Data layer condiviso**: `src/features/shiftTemplates/` (`api.ts`, `hooks.ts`,
  regole pure in `template.ts`, testate in `tests/unit/shiftTemplates/`).
- **App**: `ShiftTemplatePicker` e `SaveTemplateModal`, usati da
  `StaffShiftForm` e da `(manager)/shift/[id]`.
- **Dashboard**: `ShiftTemplatesRow` e `SaveTemplateDialog` (in un portale: nasce
  dentro il form del turno, e Invio nel nome avrebbe creato il turno), usati da
  `ShiftPanel` e `ShiftDetails`.

## Fuori, per ora

- Rinominare un modello (oggi: salvarlo con il nuovo nome ed eliminare il
  vecchio).
- Ricorrenze («ogni venerdì sera»): restano nel backlog di `TASKS.md`; il
  modello ne copre il caso più comune senza la domanda «cosa succede se la
  modifichi a metà serie».
