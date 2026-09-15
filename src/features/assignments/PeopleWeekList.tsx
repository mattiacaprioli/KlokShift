import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { cn } from "@/lib/cn";
import {
  addDaysToDate,
  formatDate,
  formatHours,
  formatShiftRange,
} from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { personRoleNames } from "@/features/staff/api";
import { useOwnerPeople } from "@/features/staff/hooks";
import {
  formatContract,
  loadTone,
  personContract,
  targetExplainer,
  weeklyTarget,
} from "@/features/staff/contract";
import { useOwnerShiftsRange } from "@/features/shifts/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { computeWeekLoad, type PersonLoad } from "./weekLoad";
import { ASSIGNMENT_STATUS_LABEL, isActiveAssignment } from "./status";

/** Iniziali dei giorni da lunedì, come nel `WeekCalendar`. */
const WEEKDAYS = ["L", "M", "M", "G", "V", "S", "D"];

const TONE_TEXT = {
  over: "text-error",
  under: "text-warning",
  on: "text-t1",
  none: "text-t1",
} as const;

/**
 * La settimana vista **per persona**, sul telefono.
 *
 * L'agenda per giorni risponde a «cosa succede mercoledì»; questa risponde a
 * «chi lavora quanto», che è la domanda da farsi *mentre* si assegna e non a
 * fine mese davanti al riepilogo ore. È la stessa vista della dashboard web
 * (`web/src/shifts/PeopleWeek.tsx`) e condivide tutto il calcolo — qui cambia
 * solo la forma: una card per persona che si apre, invece di una griglia a sette
 * colonne che su uno schermo stretto diventa illeggibile.
 *
 * Le ore sono **della persona**, su tutte le sedi del titolare: 30 ore a Roma
 * più 25 a Milano sono 55 ore su un contratto solo. Il confronto con le ore da
 * contratto compare per chi le ha sulla scheda; per gli altri la cella resta
 * neutra, perché senza un target un numero di ore non è né alto né basso.
 */
export function PeopleWeekList({
  from,
  to,
  scope,
  onOpenShift,
  paddingBottom,
}: {
  /** Lunedì della settimana mostrata (`YYYY-MM-DD`). */
  from: string;
  /** Domenica della stessa settimana, estremo incluso. */
  to: string;
  /**
   * Le sedi da contare. È il filtro per sede della tab: qui filtra **sul
   * server**, e ogni scope ha la sua chiave di cache.
   *
   * ⚠️ Solo sedi del titolare — la policy SELECT su `shifts` è larga.
   */
  scope: string[];
  onOpenShift: (shiftId: string) => void;
  paddingBottom: number;
}) {
  const { ownerId, venues, isMultiVenue } = useOwnerVenues();
  const shiftsQuery = useOwnerShiftsRange(from, to, scope);
  const peopleQuery = useOwnerPeople(ownerId);
  const pull = usePullToRefresh(() =>
    Promise.all([shiftsQuery.refetch(), peopleQuery.refetch()])
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDate(from, i)),
    [from]
  );

  const rows = useMemo(() => {
    const inScope = new Set(scope);
    const roster = (peopleQuery.data ?? [])
      // Con una sede nascosta restano solo le righe di chi in quelle accese
      // lavora davvero: una persona a zero ore che non si può nemmeno assegnare
      // qui è rumore.
      .filter((p) =>
        p.memberships.some(
          (m) => m.link_status === "active" && inScope.has(m.venue_id)
        )
      )
      .map((p) => ({
        person_id: p.id,
        display_name: p.full_name,
        roles: personRoleNames(p),
        contract: personContract(p),
      }));
    return computeWeekLoad(shiftsQuery.data ?? [], roster);
  }, [shiftsQuery.data, peopleQuery.data, scope]);

  /** Nome e colore della sede di un turno, con più sedi. */
  const venueOf = (venueId: string) => {
    if (!isMultiVenue) return null;
    const i = venues.findIndex((v) => v.id === venueId);
    return i < 0 ? null : { name: venues[i].name, accent: venueAccent(i) };
  };

  if (shiftsQuery.isPending || peopleQuery.isPending) {
    return <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />;
  }

  if (shiftsQuery.isError || peopleQuery.isError) {
    return (
      <QueryError
        onRetry={() => {
          shiftsQuery.refetch();
          peopleQuery.refetch();
        }}
        subtitle="Non siamo riusciti a caricare il carico della settimana. Riprova."
      />
    );
  }

  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const working = rows.filter((r) => r.hours > 0).length;

  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(row) => row.personId}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      }
      ListHeaderComponent={
        rows.length > 0 ? (
          <View className="mb-3 flex-row items-center justify-between gap-3">
            <Mono>
              {working} di {rows.length}{" "}
              {rows.length === 1 ? "persona" : "persone"} al lavoro
            </Mono>
            <Mono gold>{formatHours(totalHours)} programmate</Mono>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <PersonWeekCard
          person={item}
          days={days}
          venueOf={venueOf}
          onOpenShift={onOpenShift}
        />
      )}
      ListEmptyComponent={
        <View className="flex-1 justify-center">
          <EmptyState
            title="Nessuno nel tuo organico"
            subtitle="Aggiungi le persone che lavorano per te dalla scheda Staff: qui vedrai come si distribuiscono i turni fra loro."
          />
        </View>
      }
      ListFooterComponent={
        rows.length > 0 ? (
          <Text className="mt-4 text-xs leading-5 text-t3">
            Sono ore <Text className="font-sans-semibold">programmate</Text>,
            calcolate dagli orari dei turni: chi ha rifiutato o è stato segnato
            assente non le somma. Le ore effettivamente lavorate stanno nella
            pagina Ore. Il confronto con le ore da contratto compare per chi le
            ha sulla scheda.
          </Text>
        ) : null
      }
    />
  );
}

/**
 * Una persona nella settimana: il riepilogo sempre visibile, i suoi turni a
 * richiesta. Aperta mostra dove lavora e a che ora; chiusa basta la riga di
 * pallini per vedere dove ha buchi e dove è carica.
 */
function PersonWeekCard({
  person,
  days,
  venueOf,
  onOpenShift,
}: {
  person: PersonLoad;
  days: string[];
  venueOf: (venueId: string) => { name: string; accent: string } | null;
  onOpenShift: (shiftId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const target = weeklyTarget(person.contract, person.daysWorked);
  const tone = loadTone(person.hours, target);
  const explainer = targetExplainer(person.contract, target);

  // I turni della settimana in ordine: `byDay` è una mappa, l'ordine di
  // inserimento segue la query ma i giorni vanno letti dal lunedì.
  const shifts = days.flatMap((day) => person.byDay.get(day) ?? []);

  return (
    <View className="mb-3 rounded-2xl border border-border-2 bg-bg-1">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={shifts.length === 0}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${person.name}, ${formatHours(person.hours)} in ${person.daysWorked} giorni`}
        className="gap-3 px-4 py-3.5"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-sans-semibold text-t1">
              {person.name}
            </Text>
            <Text className="mt-0.5 text-xs text-t3" numberOfLines={1}>
              {person.roles ?? "Ruoli non indicati"}
            </Text>
            {person.contract ? (
              <Text className="mt-0.5 font-mono text-[10px] text-t4">
                {formatContract(person.contract)}
              </Text>
            ) : null}
          </View>

          <View className="items-end">
            <Text className={cn("font-mono text-sm", TONE_TEXT[tone])}>
              {formatHours(person.hours)}
              {target != null ? (
                <Text className="text-t4"> / {formatHours(target)}</Text>
              ) : null}
            </Text>
            <Text className="text-[10px] text-t4">
              {person.daysWorked}{" "}
              {person.daysWorked === 1 ? "giorno" : "giorni"}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row gap-2.5">
            {days.map((day, i) => (
              <DayDot
                key={day}
                label={WEEKDAYS[i]}
                shifts={person.byDay.get(day) ?? []}
              />
            ))}
          </View>
          {shifts.length > 0 ? (
            <Icon
              name="chevR"
              size={16}
              color="#8C857A"
              style={{ transform: [{ rotate: open ? "-90deg" : "90deg" }] }}
            />
          ) : null}
        </View>

        {/* Da dove esce il target quando non è il numero scritto sulla scheda:
            "173 h al mese ≈ 40 h a settimana". Senza, il rapporto sembra
            inventato. */}
        {explainer ? (
          <Text className="font-mono text-[10px] text-t4">{explainer}</Text>
        ) : null}
      </Pressable>

      {open ? (
        <View className="gap-2 border-t border-border px-4 py-3">
          {shifts.map((ps) => {
            const venue = venueOf(ps.venueId);
            const active = isActiveAssignment(ps.status);
            return (
              <Pressable
                key={ps.assignmentId}
                onPress={() => onOpenShift(ps.shiftId)}
                accessibilityRole="button"
                className="flex-row items-center gap-3"
              >
                <Mono gold={active}>{formatDate(ps.date)}</Mono>
                <View className="min-w-0 flex-1">
                  <Text
                    className={cn(
                      "text-[13px]",
                      active ? "text-t1" : "text-t4 line-through"
                    )}
                    numberOfLines={1}
                  >
                    {formatShiftRange(ps.start_time, ps.end_time)} · {ps.title}
                  </Text>
                  <Text className="text-[11px] text-t4" numberOfLines={1}>
                    {[
                      venue?.name,
                      ps.role,
                      active ? null : ASSIGNMENT_STATUS_LABEL[ps.status],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Icon name="chevR" size={14} color="#8C857A" />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Un giorno nella riga dei sette: pieno se ci lavora, vuoto se è libero.
 *
 * Un turno rifiutato o con un'assenza resta visibile ma in contorno: è un buco
 * da coprire, non una copertura — la stessa distinzione che fanno le ore, dove
 * non vengono sommate.
 */
function DayDot({
  label,
  shifts,
}: {
  label: string;
  shifts: { status: string }[];
}) {
  const active = shifts.some((s) =>
    isActiveAssignment(s.status as Parameters<typeof isActiveAssignment>[0])
  );
  const inactive = !active && shifts.length > 0;

  return (
    <View className="w-5 items-center gap-1">
      <Text
        className={cn(
          "font-mono text-[9px] uppercase",
          active ? "text-t2" : "text-t4"
        )}
      >
        {label}
      </Text>
      <View
        className={cn(
          "h-2 w-2 rounded-full border",
          active
            ? "border-gold bg-gold"
            : inactive
              ? "border-warning bg-transparent"
              : "border-border-2 bg-transparent"
        )}
      />
    </View>
  );
}
