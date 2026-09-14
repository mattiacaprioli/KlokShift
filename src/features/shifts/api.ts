import { supabase } from "@/lib/supabase";
import { addDaysToDate, isShiftOver, todayString } from "@/lib/format";
import type { Enums, TablesInsert, TablesUpdate } from "@/types/database";
import type {
  Shift,
  ShiftWithAssignees,
  ShiftWithCount,
  ShiftWithCoverage,
  ShiftWithVenue,
} from "./types";

export type {
  Shift,
  ShiftWithAssignees,
  ShiftWithCount,
  ShiftWithCoverage,
  ShiftWithVenue,
};

export const SHIFTS_PAGE_SIZE = 20;

/**
 * ⚠️ **Il filtro `venue_id` non si toglie mai.** La policy SELECT su `shifts` è
 * `"shifts: read marketplace or assigned"` — non `"shifts: manager crud own"`,
 * che copre solo insert/update/delete. Una select senza filtro restituirebbe i
 * turni `kind='marketplace'` di **tutta la piattaforma**. Da qui i due invarianti
 * di ogni funzione di questo file: `.in("venue_id", venueIds)`, e l'early-return
 * quando l'array è vuoto (`in.()` non è una query valida, e comunque un titolare
 * senza sedi non ha turni da vedere).
 *
 * L'indice `shifts_venue_date_idx (venue_id, date)` serve un `IN` esattamente
 * come un `=`: nessuna migrazione, nessun costo in più.
 */

/**
 * Turni non ancora conclusi dell'azienda ("In programma" + KPI home). Bounded.
 *
 * La finestra parte da **ieri**, non da oggi: un turno notturno iniziato ieri
 * sera è ancora in corso all'una di notte, e filtrando sulla sola data sparirebbe
 * dalle liste del ristoratore proprio mentre la sua gente è in sala. Un giorno
 * indietro è il massimo scavalcamento possibile; a scartare quelli davvero finiti
 * ci pensa `isShiftOver`, che conosce l'istante di fine vero.
 */
export async function getOwnerShifts(
  venueIds: string[]
): Promise<ShiftWithCount[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(
      // Le relazioni della copertura, non un conteggio grezzo degli assegnati:
      // gli elenchi mostrano "x/y" con `shiftCounts()`, che sui turni interni
      // ragiona per ruolo e ignora chi ha rifiutato.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id)"
    )
    .in("venue_id", venueIds)
    .gte("date", addDaysToDate(todayString(), -1))
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    // Terza chiave: con più sedi due turni possono avere stesso giorno e stessa
    // ora, e senza un tiebreak deterministico il loro ordine cambia fra un
    // refetch e l'altro — la lista balla sotto il dito.
    .order("venue_id", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as ShiftWithCount[] | null) ?? []).filter(
    (s) => !isShiftOver(s)
  );
}

/**
 * Turni dell'azienda in un intervallo di date arbitrario (estremi inclusi).
 * Serve alle viste a calendario, che devono poter navigare anche indietro:
 * `getOwnerShifts` copre solo futuri/oggi e `getOwnerPastShiftsPage` è paginata.
 * `from`/`to` sono date DB (`YYYY-MM-DD`), vedi `toDateString` in lib/format.
 *
 * Da qui passa anche il carico settimanale per persona (`computeWeekLoad`), in
 * entrambe le viste per persona (dashboard web e tab Turni dell'app): le ore da
 * contratto sono **della persona**, e 30 ore a Roma più 25 a Milano sono 55 ore
 * su un contratto solo. Prima servivano due query — questa e
 * `getOtherVenuesShiftsRange` — perché la vista era di una sede sola; ora questa
 * **è** l'unione, e la seconda non esiste più.
 */
export async function getOwnerShiftsRange(
  venueIds: string[],
  from: string,
  to: string
): Promise<ShiftWithAssignees[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(
      // Identità dell'assegnato oltre al ruolo: la stessa query alimenta la
      // copertura (per ruolo) e la vista per persona (chi lavora quanto).
      //
      // Gli altri tre campi servono al drag & drop del planning, e servono qui
      // per non fare una query in più a ogni trascinamento:
      //   · `id` dell'assegnazione → è ciò che si riassegna;
      //   · `waiter_id` → chi non ha un account collegato non riceve notifiche,
      //     quindi non va contato quando si chiede conferma.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(id, status, role_id, role:venue_roles(id, name), staff_member:staff_members(id, display_name, person_id, waiter_id))"
    )
    .in("venue_id", venueIds)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .order("venue_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ShiftWithAssignees[] | null) ?? [];
}

/** Una pagina di storico, con l'indicazione che ce ne sono altre. */
export type PastShiftsPage = {
  rows: ShiftWithCount[];
  /** Il server aveva altre righe oltre questa pagina. */
  hasMore: boolean;
};

/**
 * Storico paginato: turni passati dell'azienda, più recenti prima.
 *
 * ⚠️ `hasMore` guarda le righe **ricevute dal server**, non quelle che
 * sopravvivono al filtro: un turno notturno di ieri ancora in corso va tolto
 * dallo storico, ma se ciò rendesse la pagina più corta di `SHIFTS_PAGE_SIZE`
 * lo scroll infinito la scambierebbe per l'ultima e troncherebbe la lista.
 * Essendo l'ordine per data decrescente, quei turni stanno sempre in testa alla
 * prima pagina: il filtro costa nulla.
 */
export async function getOwnerPastShiftsPage(
  venueIds: string[],
  page: number
): Promise<PastShiftsPage> {
  if (venueIds.length === 0) return { rows: [], hasMore: false };
  const from = page * SHIFTS_PAGE_SIZE;
  const { data, error } = await supabase
    .from("shifts")
    .select(
      // Le relazioni della copertura, non un conteggio grezzo degli assegnati:
      // gli elenchi mostrano "x/y" con `shiftCounts()`, che sui turni interni
      // ragiona per ruolo e ignora chi ha rifiutato.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id)"
    )
    .in("venue_id", venueIds)
    .lt("date", todayString())
    .order("date", { ascending: false })
    .order("start_time", { ascending: false })
    // Tiebreak deterministico: `.range()` su un ordine ambiguo può ripetere o
    // saltare una riga fra una pagina e l'altra.
    .order("venue_id", { ascending: false })
    .range(from, from + SHIFTS_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const received = (data as ShiftWithCount[] | null) ?? [];
  return {
    rows: received.filter((s) => isShiftOver(s)),
    hasMore: received.length === SHIFTS_PAGE_SIZE,
  };
}

/**
 * Conteggio dei turni passati dell'azienda (KPI "turni svolti").
 *
 * Resta sulla data: un `count` esatto non si può correggere lato client. Il
 * prezzo è che, finché il turno notturno di ieri non finisce, il KPI lo conta
 * già fra gli svolti — uno scarto di un'unità per qualche ora di notte.
 */
export async function getOwnerPastShiftsCount(
  venueIds: string[]
): Promise<number> {
  if (venueIds.length === 0) return 0;
  const { count, error } = await supabase
    .from("shifts")
    .select("*", { count: "exact", head: true })
    .in("venue_id", venueIds)
    .lt("date", todayString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Il turno con il suo locale: è la query del dettaglio turno lato
 * professionista, dove servono nome e logo del locale, e `venue.owner_id` per
 * aprire la chat.
 */
export async function getShiftWithVenue(
  id: string
): Promise<ShiftWithVenue | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*, venue:venues(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ShiftWithVenue | null) ?? null;
}

export async function getShift(id: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createShift(input: TablesInsert<"shifts">): Promise<Shift> {
  const { data, error } = await supabase
    .from("shifts")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateShiftStatus(
  id: string,
  status: Enums<"shift_status">
): Promise<void> {
  const { error } = await supabase.from("shifts").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Aggiorna i campi editabili di un turno (RLS: shifts manager crud via venue). */
export async function updateShift(
  id: string,
  fields: TablesUpdate<"shifts">
): Promise<void> {
  const { error } = await supabase.from("shifts").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}
