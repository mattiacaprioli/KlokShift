import { supabase } from "@/lib/supabase";
import { addDaysToDate, isShiftOver, todayString } from "@/lib/format";
import {
  NO_PAST_FILTERS,
  normalizeQuery,
  type PastShiftsFilters,
} from "./pastFilters";
import type { Enums } from "@/types/database";
import { VENUE_MEMBER_BRIEF } from "@/features/assignments/embeds";
import type { ClockRecordWithCorrections } from "@/features/clock/hours";
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
 * ⚠️ **Il filtro `venue_id` non si toglie mai.** Le policy dicono già cosa si
 * può leggere, ma la RLS non è il perimetro della schermata: chi è anche in
 * organico di un'altra sede vede i propri turni là, e questi elenchi sono quelli
 * **delle sedi che gestisce**. Da qui i due invarianti di ogni funzione di
 * questo file: `.in("venue_id", venueIds)`, e l'early-return quando l'array è
 * vuoto (`in.()` non è una query valida, e comunque chi non gestisce sedi non ha
 * turni da vedere).
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
      // `venue_member_id` non serve alla copertura: serve al filtro «I miei
      // turni» dell'agenda, da quando chi gestisce la sede può esserci sopra.
      // È una colonna della riga già embeddata, non un join in più.
      "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id, venue_member_id)"
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
 * Turno + copertura + chi è assegnato con le sue timbrature: la forma di
 * `ShiftWithAssignees`. La usano il planning (`getOwnerShiftsRange`) e lo
 * storico, che deve saper dire quali turni conclusi hanno ancora ore da
 * approvare.
 *
 * Identità dell'assegnato oltre al ruolo: la stessa query alimenta la
 * copertura (per ruolo) e la vista per persona (chi lavora quanto).
 *
 * Gli altri tre campi servono al drag & drop del planning, e servono qui
 * per non fare una query in più a ogni trascinamento:
 *   · `id` dell'assegnazione → è ciò che si riassegna;
 *   · l'account (`user_id`) → chi non ha un account collegato non riceve
 *     notifiche, quindi non va contato quando si chiede conferma.
 * La riga di organico arriva con la persona sotto (`member`): sotto il nome
 * `staff_member` la rimette in forma `toShiftWithAssignees`.
 */
const ASSIGNEES_SELECT = `*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(id, status, role_id, worked_hours, attendance_reviewed_at, role:venue_roles(id, name), clock:shift_clock_records(*, corrections:shift_clock_corrections(*)), ${VENUE_MEMBER_BRIEF})`;

type AssigneesRow = Shift & {
  shift_role_requirements: ShiftWithAssignees["shift_role_requirements"];
  shift_assignments: (Omit<
    ShiftWithAssignees["shift_assignments"][number],
    "clock" | "staff_member"
  > & {
    clock: ClockRecordWithCorrections[];
    venue_member: {
      id: string;
      member_id: string;
      member: { display_name: string; user_id: string | null } | null;
    } | null;
  })[];
};

function toShiftWithAssignees({
  shift_assignments,
  ...shift
}: AssigneesRow): ShiftWithAssignees {
  return {
    ...shift,
    shift_assignments: shift_assignments.map(
      ({ venue_member: vm, clock, ...a }) => ({
        ...a,
        // Il vincolo è unico solo sulle righe non annullate: nello storico
        // possono esserci più tentativi, ma nel planning conta quello attivo.
        clock: clock.find((record) => record.voided_at == null) ?? null,
        staff_member: vm && {
          id: vm.id,
          display_name: vm.member?.display_name ?? "",
          person_id: vm.member_id,
          waiter_id: vm.member?.user_id ?? null,
        },
      })
    ),
  };
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
      ASSIGNEES_SELECT
    )
    .in("venue_id", venueIds)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .order("venue_id", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as AssigneesRow[] | null) ?? []).map(
    toShiftWithAssignees
  );
}

/**
 * Una pagina di storico, con l'indicazione che ce ne sono altre. Le righe
 * portano anche assegnati e timbrature: lo storico segnala i turni conclusi
 * con ore ancora da approvare e lo scostamento dal programmato.
 */
export type PastShiftsPage = {
  rows: ShiftWithAssignees[];
  /** Ultima riga DB ricevuta: cursore della pagina successiva. */
  nextCursor: PastShiftsCursor | null;
};

export type PastShiftsCursor = {
  date: string;
  start_time: string;
  id: string;
};

/**
 * Le sedi su cui interrogare: quelle scelte, ristrette a quelle dell'azienda.
 *
 * ⚠️ L'intersezione non è una pignoleria: la policy SELECT su `shifts` è larga
 * (vedi il commento in testa al file), e un `venue_id` arbitrario nei filtri
 * mostrerebbe i turni di un'altra azienda.
 */
function pastScope(venueIds: string[], filters: PastShiftsFilters): string[] {
  if (!filters.venueIds) return venueIds;
  const owned = new Set(venueIds);
  return filters.venueIds.filter((id) => owned.has(id));
}

/**
 * Gli argomenti comuni delle due RPC. Pagina e conteggio arrivano così allo
 * stesso predicato SQL (`private.owner_past_shift_matches`) con gli stessi
 * valori, inclusa la normalizzazione della ricerca.
 */
function pastRpcFilters(scope: string[], filters: PastShiftsFilters) {
  const text = normalizeQuery(filters.q);
  return {
    p_venue_ids: scope,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_status: filters.status,
    p_role_ids: filters.role?.ids.length ? filters.role.ids : undefined,
    p_query: text || undefined,
  };
}

/**
 * Storico paginato: turni passati dell'azienda, più recenti prima.
 *
 * Il server applica prima il fine effettivo e tutti i filtri, poi il cursore:
 * ogni pagina è piena e un turno entra qui nello stesso istante in cui esce
 * dalla lista «In programma» dopo il refetch.
 */
export async function getOwnerPastShiftsPage(
  venueIds: string[],
  cursor: PastShiftsCursor | null,
  filters: PastShiftsFilters = NO_PAST_FILTERS
): Promise<PastShiftsPage> {
  const scope = pastScope(venueIds, filters);
  if (scope.length === 0) return { rows: [], nextCursor: null };
  const { data, error } = await supabase
    .rpc("get_owner_past_shifts_page", {
      ...pastRpcFilters(scope, filters),
      p_limit: SHIFTS_PAGE_SIZE,
      p_before_date: cursor?.date,
      p_before_start: cursor?.start_time,
      p_before_id: cursor?.id,
    })
    // Le relazioni della copertura restano intere anche col filtro mansione:
    // quel filtro vive nell'EXISTS della RPC e non taglia questo innesto.
    .select(ASSIGNEES_SELECT);
  if (error) throw new Error(error.message);
  const received = ((data as unknown as AssigneesRow[] | null) ?? []).map(
    toShiftWithAssignees
  );
  return {
    rows: received,
    nextCursor:
      received.length === SHIFTS_PAGE_SIZE
        ? {
            date: received[received.length - 1].date,
            start_time: received[received.length - 1].start_time,
            id: received[received.length - 1].id,
          }
        : null,
  };
}

/**
 * Conteggio esatto dello stesso insieme paginato sopra. Il predicato condiviso
 * sul server evita che un notturno o un turno concluso oggi compaia soltanto in
 * uno dei due risultati.
 */
export async function getOwnerPastShiftsCount(
  venueIds: string[],
  filters: PastShiftsFilters = NO_PAST_FILTERS
): Promise<number> {
  const scope = pastScope(venueIds, filters);
  if (scope.length === 0) return 0;
  const { data, error } = await supabase.rpc(
    "get_owner_past_shifts_count",
    pastRpcFilters(scope, filters)
  );
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Il turno con la sua sede: è la query del dettaglio turno lato
 * professionista, dove servono nome e logo della sede, e `venue.workspace_id`
 * per aprire la chat con l'azienda.
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

/**
 * Stato del turno (RPC `set_shift_status`): annullare, chiudere, riaprire.
 * L'update diretto su `shifts` è revocato; la RPC solleva `not_allowed` se non
 * si ha il permesso Turni sulla sede, invece di non fare niente.
 */
export async function updateShiftStatus(
  id: string,
  status: Enums<"shift_status">
): Promise<void> {
  const { error } = await supabase.rpc("set_shift_status", {
    p_shift: id,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

/** I campi di un turno che si possono cambiare da soli (senza persone né ruoli). */
export type ShiftFieldsPatch = Partial<
  Pick<
    Shift,
    | "title"
    | "date"
    | "start_time"
    | "end_time"
    | "description"
    | "require_confirmation"
  >
>;

/**
 * Cambia i campi base di un turno (es. spostarlo di giorno) lasciando com'è il
 * resto: `update_shift` senza le chiavi `staff` e `role_targets` non tocca né
 * assegnati né fabbisogno. La RPC vuole il turno intero, quindi si legge quello
 * attuale e si sovrappone la patch.
 */
export async function updateShift(
  id: string,
  fields: ShiftFieldsPatch
): Promise<void> {
  const current = await getShift(id);
  if (!current) throw new Error("not_allowed");
  const next = { ...current, ...fields };
  const { error } = await supabase.rpc("update_shift", {
    p_shift: id,
    p_payload: {
      title: next.title,
      date: next.date,
      start_time: next.start_time,
      end_time: next.end_time,
      description: next.description,
      require_confirmation: next.require_confirmation,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Elimina un turno (RPC `delete_shift`). Un turno già finito **con persone**
 * resta: è storico, ore, presenze (`finished_shift_locked`).
 */
export async function deleteShift(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_shift", { p_shift: id });
  if (error) throw new Error(error.message);
}
