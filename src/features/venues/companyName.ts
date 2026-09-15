/**
 * Come si chiama l'azienda, quando l'azienda non ha un nome.
 *
 * Non esiste un campo "ragione sociale": inventarlo adesso sarebbe una colonna, un
 * form e un passaggio di onboarding per riempire un'intestazione. La regola è
 * quindi **la stessa di `chat_counterpart`** (20260913100200), e deve restarlo: se
 * in chat il professionista legge "Giuseppe Buffa", il commercialista non può
 * ricevere un file intestato "Trattoria Roma", o i due documenti non parlano della
 * stessa persona.
 *
 *   · UNA sede aperta → il nome della sede. Identico a prima per chi ha una sede
 *     solo, che continua a esportare "ore-osteria-milano-settembre-2026.csv".
 *   · PIÙ sedi → il nome del titolare (`profiles.full_name`), con fallback sul nome
 *     della sede più vecchia — il marchio con cui il gruppo è nato — e poi su una
 *     frase generica.
 *
 * Puro di proposito: nessun import: lo usano l'app e la dashboard.
 */
export function companyName(
  /** `getMyVenues`: solo le aperte, la più vecchia prima. */
  openVenues: { name: string }[],
  ownerFullName: string | null | undefined
): string {
  if (openVenues.length === 1) return openVenues[0].name;
  const owner = ownerFullName?.trim();
  if (owner) return owner;
  return openVenues[0]?.name ?? "La tua azienda";
}
