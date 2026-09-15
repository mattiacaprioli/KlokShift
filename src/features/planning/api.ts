import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

/**
 * Il planning di una sede visto da chi ci lavora.
 *
 * Passa **tutto** dalla RPC `get_staff_planning` (20260914150000) e mai da una
 * select diretta: le policy di `shifts`, `shift_assignments` e `staff_members`
 * mostrano al professionista solo sé stesso, e allargarle esporrebbe anche
 * telefono e note dei colleghi. La funzione DEFINER decide le colonne, e ne
 * escono solo nome, foto e mansione del giorno.
 *
 * ⚠️ Non esiste una variante "per sede": la RPC restituisce da sé tutte le sedi
 * in cui chi chiama è in organico attivo, perché non c'è nessun parametro con
 * cui farsi dare il planning di una sede altrui.
 */

/** Una riga piatta come la restituisce il database: una per persona in turno. */
type PlanningRow = {
  venue_id: string;
  venue_name: string;
  venue_logo_url: string | null;
  shift_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  /** `null` su un turno che non ha ancora nessuno. */
  staff_member_id: string | null;
  person_name: string | null;
  avatar_url: string | null;
  role_name: string | null;
  is_me: boolean;
};

/** Un collega in turno. Nient'altro: il resto della sua scheda non esce dal DB. */
export type PlanningPerson = {
  staffMemberId: string;
  name: string;
  avatarUrl: string | null;
  /** La mansione di quel giorno, se la sede l'ha scelta. */
  roleName: string | null;
  isMe: boolean;
};

/** Un turno della sede, con chi ci lavora. */
export type PlanningShift = {
  id: string;
  venueId: string;
  venueName: string;
  venueLogoUrl: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Chi c'è. Vuoto = turno ancora scoperto, che è un'informazione anche quella. */
  people: PlanningPerson[];
  /** Se il professionista è fra loro: la card lo segnala. */
  includesMe: boolean;
};

/**
 * Le righe piatte diventano turni.
 *
 * Funzione pura ed esportata perché è l'unico punto in cui la forma del DB
 * diventa la forma dell'interfaccia: tenerla fuori dalla `fetch` la rende
 * verificabile senza rete. Si appoggia all'ordinamento della RPC (`date`,
 * `start_time`, `shift_id`), quindi le righe di uno stesso turno sono contigue.
 */
export function groupPlanningRows(rows: PlanningRow[]): PlanningShift[] {
  const shifts: PlanningShift[] = [];
  for (const row of rows) {
    let shift = shifts[shifts.length - 1];
    if (shift?.id !== row.shift_id) {
      shift = {
        id: row.shift_id,
        venueId: row.venue_id,
        venueName: row.venue_name,
        venueLogoUrl: row.venue_logo_url,
        title: row.title,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        people: [],
        includesMe: false,
      };
      shifts.push(shift);
    }
    // `staff_member_id` null è il turno scoperto: la riga esiste per il turno,
    // non per la persona.
    if (row.staff_member_id && row.person_name) {
      shift.people.push({
        staffMemberId: row.staff_member_id,
        name: row.person_name,
        avatarUrl: row.avatar_url,
        roleName: row.role_name,
        isMe: row.is_me,
      });
      if (row.is_me) shift.includesMe = true;
    }
  }
  return shifts;
}

/**
 * Il planning delle sedi del professionista, da `from` a `to` inclusi.
 *
 * Il database taglia comunque a 62 giorni: chiedere di più non è un errore,
 * restituisce meno.
 */
export async function getStaffPlanning(
  from: string,
  to: string
): Promise<PlanningShift[]> {
  const { data, error } = await supabase.rpc("get_staff_planning", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return groupPlanningRows((data as PlanningRow[] | null) ?? []);
}

/** La squadra di **un** turno: le stesse righe, filtrate su quel turno. */
export function teamOfShift(
  shifts: PlanningShift[],
  shiftId: string
): PlanningShift | null {
  return shifts.find((s) => s.id === shiftId) ?? null;
}

/** Il campo che il titolare comanda dalla scheda della sede. */
export type VenuePlanningVisibility = Pick<
  Tables<"venues">,
  "id" | "staff_sees_planning"
>;

/** Manager: accende o spegne la condivisione del planning con l'organico. */
export async function setVenueSeesPlanning(
  venueId: string,
  visible: boolean
): Promise<void> {
  const { error } = await supabase
    .from("venues")
    .update({ staff_sees_planning: visible })
    .eq("id", venueId);
  if (error) throw new Error(error.message);
}
