// Le righe del giorno per l'export ore, dalla RPC alla persona.
//
// Modulo **puro**: nessun import di Supabase, Expo o React (lo usa anche la
// dashboard web).

export type DailyKind = "work" | "to_fix" | "ferie" | "permesso" | "malattia";

/** Una riga di `get_workspace_hours_daily`. I tipi generati la danno tutta non
 *  nulla e `numeric` come number: in realtà i campi sotto possono mancare e
 *  `hours` può arrivare come stringa. */
export type DbDailyRow = {
  member_id: string;
  member_name: string;
  date: string;
  kind: string;
  venue_name: string | null;
  title: string | null;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | null;
  break_paid: boolean | null;
  hours: number | string | null;
  /** `HourToFixKind` su to_fix, 'conflict', 'hourly:HH:MM-HH:MM' o null. */
  note: string | null;
};

export type HoursDailyRow = {
  person_id: string;
  person_name: string;
  date: string;
  kind: DailyKind;
  venue_name: string | null;
  title: string | null;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | null;
  break_paid: boolean | null;
  hours: number | null;
  note: string | null;
};

export function toHoursDailyRows(rows: DbDailyRow[]): HoursDailyRow[] {
  return rows.map(({ member_id, member_name, kind, hours, ...row }) => ({
    ...row,
    person_id: member_id,
    person_name: member_name,
    kind: kind as DailyKind,
    hours: hours === null ? null : Number(hours),
  }));
}
