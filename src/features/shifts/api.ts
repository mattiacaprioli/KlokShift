import { supabase } from "@/lib/supabase";
import { addDaysToDate, isShiftOver, todayString } from "@/lib/format";
import type { Enums, TablesInsert, TablesUpdate } from "@/types/database";
import type {
  ElsewhereShift,
  Shift,
  ShiftWithAssignees,
  ShiftWithCount,
  ShiftWithCoverage,
  ShiftWithVenue,
} from "./types";

export type {
  ElsewhereShift,
  Shift,
  ShiftWithAssignees,
  ShiftWithCount,
  ShiftWithCoverage,
  ShiftWithVenue,
};

export const SHIFTS_PAGE_SIZE = 20;

/**
 * Turni non ancora conclusi del locale ("In programma" + KPI home). Bounded.
 *
 * La finestra parte da **ieri**, non da oggi: un turno notturno iniziato ieri
 * sera è ancora in corso all'una di notte, e filtrando sulla sola data sparirebbe
 * dalle liste del ristoratore proprio mentre la sua gente è in sala. Un giorno
 * indietro è il massimo scavalcamento possibile; a scartare quelli davvero finiti
 * ci pensa `isShiftOver`, che conosce l'istante di fine vero.
 */
export async function getMyShifts(venueId: string): Promise<ShiftWithCount[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select(
      // Le relazioni della copertura, non un conteggio grezzo degli assegnati:
      // gli elenchi mostrano "x/y" con `shiftCounts()`, che sui turni interni
      // ragiona per ruolo e ignora chi ha rifiutato.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id)"
    )
    .eq("venue_id", venueId)
    .gte("date", addDaysToDate(todayString(), -1))
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as ShiftWithCount[] | null) ?? []).filter(
    (s) => !isShiftOver(s)
  );
}

/**
 * Turni del locale in un intervallo di date arbitrario (estremi inclusi).
 * Serve alle viste a calendario, che devono poter navigare anche indietro:
 * `getMyShifts` copre solo futuri/oggi e `getVenuePastShiftsPage` è paginata.
 * `from`/`to` sono date DB (`YYYY-MM-DD`), vedi `toDateString` in lib/format.
 */
export async function getVenueShiftsRange(
  venueId: string,
  from: string,
  to: string
): Promise<ShiftWithAssignees[]> {
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
    .eq("venue_id", venueId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ShiftWithAssignees[] | null) ?? [];
}

/**
 * I turni dell'intervallo nelle **altre** sedi del titolare.
 *
 * Serve a una cosa sola, ed è una correzione di sostanza: le soglie 40h/48h
 * settimanali sono **della persona**, non del locale. Prima 30 ore a Roma più 25 a
 * Milano erano due celle verdi in due viste diverse, mentre sono 55 ore e uno
 * straordinario — e nessuno lo vedeva.
 *
 * `.in("venue_id", ids)` e non una RPC: la RLS di `shifts` («shifts: manager crud
 * own») limita già al titolare. Con una sede sola l'array è vuoto e la query non
 * parte nemmeno: la vista Persone resta byte per byte quella di prima.
 */
export async function getOtherVenuesShiftsRange(
  venueIds: string[],
  from: string,
  to: string
): Promise<ElsewhereShift[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "id, venue_id, date, start_time, end_time, status, venue:venues(id, name), " +
        "shift_assignments(id, status, staff_member:staff_members(id, person_id))"
    )
    .in("venue_id", venueIds)
    .gte("date", from)
    .lte("date", to);
  if (error) throw new Error(error.message);
  // `as unknown`: su un embed annidato PostgREST non riesce a inferire il tipo e
  // il cast diretto non si sovrappone. Stessa scorciatoia del resto del file.
  return (data as unknown as ElsewhereShift[] | null) ?? [];
}

/** Una pagina di storico, con l'indicazione che ce ne sono altre. */
export type PastShiftsPage = {
  rows: ShiftWithCount[];
  /** Il server aveva altre righe oltre questa pagina. */
  hasMore: boolean;
};

/**
 * Storico paginato: turni passati del locale, più recenti prima.
 *
 * ⚠️ `hasMore` guarda le righe **ricevute dal server**, non quelle che
 * sopravvivono al filtro: un turno notturno di ieri ancora in corso va tolto
 * dallo storico, ma se ciò rendesse la pagina più corta di `SHIFTS_PAGE_SIZE`
 * lo scroll infinito la scambierebbe per l'ultima e troncherebbe la lista.
 * Essendo l'ordine per data decrescente, quei turni stanno sempre in testa alla
 * prima pagina: il filtro costa nulla.
 */
export async function getVenuePastShiftsPage(
  venueId: string,
  page: number
): Promise<PastShiftsPage> {
  const from = page * SHIFTS_PAGE_SIZE;
  const { data, error } = await supabase
    .from("shifts")
    .select(
      // Le relazioni della copertura, non un conteggio grezzo degli assegnati:
      // gli elenchi mostrano "x/y" con `shiftCounts()`, che sui turni interni
      // ragiona per ruolo e ignora chi ha rifiutato.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id)"
    )
    .eq("venue_id", venueId)
    .lt("date", todayString())
    .order("date", { ascending: false })
    .order("start_time", { ascending: false })
    .range(from, from + SHIFTS_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const received = (data as ShiftWithCount[] | null) ?? [];
  return {
    rows: received.filter((s) => isShiftOver(s)),
    hasMore: received.length === SHIFTS_PAGE_SIZE,
  };
}

/**
 * Conteggio dei turni passati del locale (KPI "turni svolti").
 *
 * Resta sulla data: un `count` esatto non si può correggere lato client. Il
 * prezzo è che, finché il turno notturno di ieri non finisce, il KPI lo conta
 * già fra gli svolti — uno scarto di un'unità per qualche ora di notte.
 */
export async function getVenuePastShiftsCount(venueId: string): Promise<number> {
  const { count, error } = await supabase
    .from("shifts")
    .select("*", { count: "exact", head: true })
    .eq("venue_id", venueId)
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
