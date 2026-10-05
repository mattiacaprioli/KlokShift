import * as SecureStore from "expo-secure-store";

/**
 * Come il professionista preferisce guardare i propri turni: l'elenco per
 * giorno o la settimana a griglia oraria.
 *
 * È una comodità come `viewModeStorage`, e per la stessa ragione sta in
 * `expo-secure-store` con una chiave per account: su un telefono condiviso due
 * persone non si scambiano la vista.
 */
export type AgendaLayout = "list" | "week";

const key = (userId: string) => `agendaLayout.${userId}`;

export async function loadAgendaLayout(
  userId: string
): Promise<AgendaLayout | null> {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(key(userId));
    return raw === "list" || raw === "week" ? raw : null;
  } catch {
    // Illeggibile: si riparte dall'elenco.
    return null;
  }
}

export async function saveAgendaLayout(
  userId: string,
  layout: AgendaLayout
): Promise<void> {
  if (!userId) return;
  try {
    await SecureStore.setItemAsync(key(userId), layout);
  } catch {
    // Non ricordare la vista costa un tocco alla prossima apertura.
  }
}
