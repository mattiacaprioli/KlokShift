/**
 * Per chi si può registrare un'assenza dalla gestione: la scelta della persona
 * in «Registra assenza» della pagina Assenze (app e dashboard).
 *
 * Specchio in UI di `record_absence`, che decide comunque da sé:
 *   * serve «Team» su almeno una sede della persona (`private.can_person`);
 *   * su sé stessi solo il titolare (`private.is_restricted_self`): un
 *     collaboratore le proprie ferie le chiede, non se le approva.
 * Solo chi è nel team di una sede: chi gestisce e basta non ha turni da
 * liberare. Il titolare trova sé stesso **in cima**, perché è il caso per cui
 * questa scelta esiste (le sue ferie non le chiede a nessuno).
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa.
 */
export type RecordForPerson = {
  id: string;
  full_name: string;
  waiter_id: string | null;
  memberships: readonly { venue_id: string }[];
};

export type RecordForOption = { id: string; name: string; isMe: boolean };

export function recordAbsenceOptions(
  people: readonly RecordForPerson[],
  {
    myId,
    isOwner,
    canStaffOn,
  }: {
    myId: string;
    isOwner: boolean;
    /** `can(venueId, "can_manage_staff")`. */
    canStaffOn: (venueId: string) => boolean;
  }
): RecordForOption[] {
  const options: RecordForOption[] = [];
  for (const p of people) {
    if (p.memberships.length === 0) continue;
    const isMe = !!myId && p.waiter_id === myId;
    if (isMe && !isOwner) continue;
    if (!isOwner && !p.memberships.some((m) => canStaffOn(m.venue_id))) continue;
    options.push({ id: p.id, name: p.full_name, isMe });
  }
  // L'ordine per nome resta quello del team; il titolare stesso va in cima.
  return options.sort((a, b) => Number(b.isMe) - Number(a.isMe));
}
