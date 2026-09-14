import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import { useStaffPlanning } from "./hooks";
import { teamOfShift } from "./api";
import { TeamRow } from "./TeamRow";

/**
 * «Con chi lavori» — la squadra di un turno, nel suo dettaglio.
 *
 * Passa dalla stessa RPC della vista «Il locale» (`get_staff_planning`) su un
 * intervallo di un giorno solo, e non da una query dedicata: è l'unica fonte
 * che sa filtrare le colonne, e una seconda funzione con le stesse regole di
 * visibilità sarebbe la prima a divergere da questa.
 *
 * Non compare **niente** quando il locale non condivide il planning o quando il
 * turno è di una sede in cui non si è più in organico: la RPC non restituisce la
 * riga, `team` resta null e la sezione si toglie di mezzo. È voluto — un blocco
 * «non disponibile» spiegherebbe al professionista una scelta del titolare che
 * non è affar suo.
 */
export function ShiftTeamSection({
  shiftId,
  date,
  className,
}: {
  shiftId: string;
  /** Il giorno del turno: è l'intervallo che si chiede al database. */
  date: string;
  className?: string;
}) {
  const planning = useStaffPlanning(date, date);
  const team = planning.data ? teamOfShift(planning.data, shiftId) : null;

  if (planning.isLoading) {
    return (
      <View className={cn("items-center py-6", className)}>
        <ActivityIndicator color="#EAB54C" />
      </View>
    );
  }

  // Errore compreso: è una sezione accessoria, e un riquadro rosso sopra i
  // bottoni di conferma sposterebbe l'attenzione dall'azione della schermata.
  if (!team) return null;

  // Da soli in turno non c'è una squadra da mostrare.
  const others = team.people.filter((p) => !p.isMe);
  if (others.length === 0) return null;

  return (
    <View className={cn("gap-2", className)}>
      <SectionHeader className="mb-0" title="Con chi lavori" />
      <Card className="rounded-3xl border-border-2 px-4 py-2">
        {team.people.map((p) => (
          <TeamRow key={p.staffMemberId} person={p} />
        ))}
      </Card>
      <Text className="px-1 text-[12px] text-t4">
        Chi il locale ha messo in turno con te. Gli orari individuali possono
        cambiare: la parola definitiva è del locale.
      </Text>
    </View>
  );
}
