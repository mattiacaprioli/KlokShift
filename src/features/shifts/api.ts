import { supabase } from "@/lib/supabase";
import { addDaysToDate, isShiftOver, todayString } from "@/lib/format";
import {
  NO_PAST_FILTERS,
  normalizeQuery,
  type PastShiftsFilters,
} from "./pastFilters";
import type { Enums } from "@/types/database";
import { VENUE_MEMBER_BRIEF } from "@/features/assignments/embeds";
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
      //   · l'account (`user_id`) → chi non ha un account collegato non riceve
      //     notifiche, quindi non va contato quando si chiede conferma.
      // La riga di organico arriva con la persona sotto (`member`): sotto il nome
      // `staff_member` la rimette in forma `toStaffMember`.
      `*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(id, status, role_id, role:venue_roles(id, name), ${VENUE_MEMBER_BRIEF})`
    )
    .in("venue_id", venueIds)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .order("venue_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ shift_assignments, ...shift }) => ({
    ...shift,
    shift_assignments: shift_assignments.map(({ venue_member: vm, ...a }) => ({
      ...a,
      staff_member: vm && {
        id: vm.id,
        display_name: vm.member?.display_name ?? "",
        person_id: vm.member_id,
        waiter_id: vm.member?.user_id ?? null,
      },
    })),
  }));
}

/** Una pagina di storico, con l'indicazione che ce ne sono altre. */
export type PastShiftsPage = {
  rows: ShiftWithCount[];
  /** Ultima riga DB ricevuta: cursore della pagina successiva. */
  nextCursor: PastShiftsCursor | null;
};

export type PastShiftsCursor = {
  date: string;
  start_time: string;
  id: string;
};

/** Le relazioni della copertura: le stesse di `getOwnerShifts`. */
const PAST_SELECT =
  "*, shift_role_requirements(role_id, count, role:venue_roles(name)), shift_assignments(status, role_id)";

/**
 * Il filtro per ruolo è un **secondo** innesto della stessa tabella, con alias e
 * `!inner`: `!inner` trasforma l'innesto in join e scarta i turni che non hanno
 * quel fabbisogno. Non si può filtrare su `shift_role_requirements` direttamente
 * perché quell'innesto alimenta la copertura ("2/3"), e filtrarlo lascerebbe
 * nella riga solo il fabbisogno cercato: il turno risulterebbe scoperto di tutti
 * gli altri ruoli. L'alias porta il filtro, l'innesto originale resta intero.
 */
const PAST_SELECT_BY_ROLE = `${PAST_SELECT}, role_filter:shift_role_requirements!inner(role_id)`;

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
 * Applica al builder i filtri dello storico. Generico sul builder: i due
 * chiamanti (pagina e conteggio) partono da `select()` diversi, e i filtri
 * PostgREST tornano sempre lo stesso builder.
 */
function withPastFilters<
  Q extends {
    in(column: string, values: string[]): Q;
    lt(column: string, value: string): Q;
    gte(column: string, value: string): Q;
    lte(column: string, value: string): Q;
    eq(column: string, value: string): Q;
    neq(column: string, value: string): Q;
    ilike(column: string, pattern: string): Q;
  },
>(query: Q, scope: string[], filters: PastShiftsFilters): Q {
  let q = query.in("venue_id", scope).lt("date", todayString());
  if (filters.from) q = q.gte("date", filters.from);
  if (filters.to) q = q.lte("date", filters.to);
  // "Concluso" è tutto ciò che non è stato annullato: `open` e `closed` sono
  // stati della pubblicazione, non dell'esito — un turno passato e mai chiuso a
  // mano è comunque un turno svolto.
  if (filters.status === "cancelled") q = q.eq("status", "cancelled");
  else if (filters.status === "done") q = q.neq("status", "cancelled");
  if (filters.role && filters.role.ids.length > 0) {
    q = q.in("role_filter.role_id", filters.role.ids);
  }
  const text = normalizeQuery(filters.q);
  if (text) q = q.ilike("title", `%${text}%`);
  return q;
}

/**
 * Storico paginato: turni passati dell'azienda, più recenti prima.
 *
 * ⚠️ Il cursore guarda l'ultima riga **ricevuta dal server**, non quelle che
 * sopravvivono al filtro: un turno notturno di ieri ancora in corso va tolto
 * dallo storico, ma non deve cambiare il punto da cui riparte la pagina dopo.
 * Essendo l'ordine per data decrescente, quei turni stanno sempre in testa alla
 * prima pagina: il filtro costa nulla.
 */
export async function getOwnerPastShiftsPage(
  venueIds: string[],
  cursor: PastShiftsCursor | null,
  filters: PastShiftsFilters = NO_PAST_FILTERS
): Promise<PastShiftsPage> {
  const scope = pastScope(venueIds, filters);
  if (scope.length === 0) return { rows: [], nextCursor: null };
  let query = withPastFilters(
    // Le relazioni della copertura, non un conteggio grezzo degli assegnati:
    // gli elenchi mostrano "x/y" con `shiftCounts()`, che sui turni interni
    // ragiona per ruolo e ignora chi ha rifiutato.
    supabase
      .from("shifts")
      .select(filters.role ? PAST_SELECT_BY_ROLE : PAST_SELECT),
    scope,
    filters
  )
    .order("date", { ascending: false })
    .order("start_time", { ascending: false })
    // `id` rende totale l'ordine anche con due turni identici per data e ora.
    .order("id", { ascending: false })
    .limit(SHIFTS_PAGE_SIZE);
  if (cursor) {
    query = query.or(
      `date.lt.${cursor.date},and(date.eq.${cursor.date},start_time.lt.${cursor.start_time}),and(date.eq.${cursor.date},start_time.eq.${cursor.start_time},id.lt.${cursor.id})`
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const received = (data as unknown as ShiftWithCount[] | null) ?? [];
  return {
    rows: received.filter((s) => isShiftOver(s)),
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
 * Conteggio dei turni passati dell'azienda (KPI "turni svolti").
 *
 * Resta sulla data: un `count` esatto non si può correggere lato client. Il
 * prezzo è che, finché il turno notturno di ieri non finisce, il KPI lo conta
 * già fra gli svolti — uno scarto di un'unità per qualche ora di notte.
 */
export async function getOwnerPastShiftsCount(
  venueIds: string[],
  filters: PastShiftsFilters = NO_PAST_FILTERS
): Promise<number> {
  const scope = pastScope(venueIds, filters);
  if (scope.length === 0) return 0;
  const { count, error } = await withPastFilters(
    supabase
      .from("shifts")
      .select(filters.role ? "*, role_filter:shift_role_requirements!inner(role_id)" : "*", {
        count: "exact",
        head: true,
      }),
    scope,
    filters
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
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
