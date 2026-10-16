# Pausa nei turni

> **Decisione di prodotto e implementazione — 2026-10-16.** Migration
> `20261016000000_shift_breaks.sql` e `20261016000100_work_history_proposed_hours.sql`,
> suite `supabase/tests/rls/031_breaks.sql`. Completa le timbrature
> (`CLOCK_IN_OUT.md`), la timbratura senza turno ([UNPLANNED-CLOCK.md](UNPLANNED-CLOCK.md))
> e [HOURS-ABSENCES-ADJUSTMENTS.md](HOURS-ABSENCES-ADJUSTMENTS.md).

## Il caso

Fino al 16/10 un turno 18–24 valeva sempre 6 ore e la timbratura aveva un solo
intervallo entrata→uscita. Le sedi però devono decidere se la pausa si paga
(resta nelle ore) oppure no (si toglie e compare a parte), e il consulente deve
vederla.

## Come fanno i concorrenti (ricerca 2026-10-16)

| Prodotto | Dove si decide | Retribuita o no | Durata | Timbratura |
|---|---|---|---|---|
| Skello (ristorazione FR) | Impostazioni **sede** › Regole, «Activer la rémunération des pauses», con data di decorrenza e storico invariato | Spunta: resta nella durata. Senza: si sottrae | Pausa automatica dopo N ore consecutive (6 h → da 6h01), solo nello stesso turno | Uscita e rientro pausa per la durata reale |
| Planday (ospitalità) | Regole per reparto/gruppo, più pausa manuale sul turno | Flag «Paid break»; nel report paghe «Break» e «Break (Paid)» | Regole per durata minima o fascia oraria | Pause timbrate, non retribuite di default, al posto di quelle automatiche |
| 7shifts (ristoranti) | Impostazioni timbratura, solo admin | Paid/Unpaid per tutte, o regole personalizzate | Minuti + durata minima del turno | Il dipendente timbra la pausa e non vede se è pagata |
| Deputy | Impostazioni **sede** › Timesheets | «meal» non retribuita, «rest» retribuita | Durata predefinita per sede | Pausa pianificata non timbrata aggiunta comunque; avviso se mancata |
| Connecteam | Timbratura › Breaks | Retribuita nel totale, non retribuita esclusa | Deduzione dopo X ore, ⚠️ applicata a tutto lo storico | Pause timbrate |

Contesto italiano: il D.Lgs. 66/2003, art. 8, prevede una pausa oltre le 6 ore
(almeno 10 minuti, salvo CCNL). Il CCNL Pubblici Esercizi, art. 122, fissa il
pasto fra 30 e 60 minuti, rinviando la durata alla contrattazione integrativa;
non dice se sia retribuito. È una scelta del datore: nell'interfaccia non ci
sono soglie di legge.

## La regola

> **La sede decide se la pausa è retribuita. Retribuita resta nelle ore
> lavorate; non retribuita si toglie. In entrambi i casi l'export la dice a parte.**

- **Per sede**, come il metodo di timbratura: sedi in città diverse possono
  avere integrativi diversi. La cambia chi ha «Ore» (`set_venue_break_policy`).
  Predefinito: non retribuita.
- **Copia sul turno.** `shifts.break_paid` nasce dalla sede (trigger, mai dal
  client) e la scelta nuova vale per i turni **non ancora conclusi**: lo storico
  non cambia, come col congelamento di `hours_source`. È l'errore che
  Connecteam documenta e che qui non si ripete.
- **Durata pianificata sul turno**: `shifts.break_minutes` (0–240, sempre più
  corta del turno). La regola facoltativa della sede («turni oltre 6 h: 30
  min») **precompila** il form e basta: non si applica da sola, non tocca i
  turni esistenti. Cambiarla non notifica nessuno e non riapre conferme.
- **Timbratura.** Il professionista timbra inizio e fine pausa
  (`clock_break`), anche nel fuori turno; uscire in pausa la chiude.
  `shift_clock_breaks` è append-only per il client e ha `venue_id` per il
  realtime.
- **Pausa effettiva di una timbratura**, in ordine: l'ultima correzione di chi
  gestisce (`correct_clock_break`, motivo obbligatorio, riapre l'approvazione),
  la somma delle pause timbrate tagliate fra entrata e uscita, la pausa
  pianificata del turno (0 per il fuori turno).

### Ore

```text
ore conteggiate del turno   = durata − (retribuita ? 0 : pausa pianificata)
ore proposte da timbratura  = quarto d'ora(arco − (retribuita ? 0 : pausa effettiva))
```

- Metodo Manuale: le ore del turno concluso sono le conteggiate.
- Timbratura: approvazione, riepilogo e storico usano la stessa funzione
  (`private.clock_record_counted_hours`).
- «Approva le timbrature in orario» confronta ore conteggiate con ore
  conteggiate. Una pausa non retribuita più corta o più lunga di quella
  pianificata cambia le ore e la timbratura si guarda a parte, senza un'anomalia
  nuova.
- Riepilogo mensile, CSV e PDF: «Di cui pausa retribuita» (già inclusa) e
  «Pausa non retribuita esclusa», mai sommate a un totale.

⚠️ Gemelli **manuali** in TypeScript: `shiftCountedHours` (`src/lib/format.ts`)
di `shift_counted_hours`, `effectiveClockBreak` e `clockedHours`
(`src/features/clock/hours.ts`) di `clock_record_break` e
`clock_record_counted_hours`. Se cambia uno, cambia l'altro.

## Fuori perimetro

- Pause multiple con tipo diverso (pasto non retribuito + riposo retribuito
  sullo stesso turno, come Deputy): oggi la scelta è una per sede.
- Scelta per persona o per contratto.
- Avvisi sulla pausa mancata o sotto il minimo di legge: KlokShift non conosce
  il CCNL applicato.
- Pausa automatica sul fuori turno: vale solo quella timbrata, chi approva la
  corregge.
- Il planning dei colleghi (`get_staff_planning`) mostra ancora la durata
  dell'arco, senza pausa.
