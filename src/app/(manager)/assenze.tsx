import { ListSkeleton } from "@/components/ui/Skeleton";
import { useMemo, useState } from "react";
import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChipRow, FilterChip } from "@/components/ui/FilterChip";
import { Icon } from "@/components/ui/Icon";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { AbsenceList } from "@/features/absences/AbsenceList";
import { COMPANY_ABSENCES_DAYS_BACK } from "@/features/absences/api";
import {
  NO_ABSENCE_FILTERS,
  absencePeopleOf,
  activeAbsenceFilterCount,
  filterCompanyAbsences,
  memberIdsInVenue,
  toggleAbsenceKind,
  type CompanyAbsenceFilters,
} from "@/features/absences/filters";
import { useCompanyAbsences } from "@/features/absences/hooks";
import { ABSENCE_KINDS, groupCompanyAbsences } from "@/features/absences/labels";

/**
 * Ferie, permessi e malattie di tutta l'azienda: da decidere, in corso e
 * prossime, passate da poco.
 *
 * Una pagina dentro Staff e non una tab: le assenze arrivano poche volte al
 * mese, e una tab vuota quasi sempre ruberebbe il posto a Turni e Messaggi. Il
 * richiamo quotidiano resta il blocco «Richieste» della home e il badge sulla
 * tab Staff.
 *
 * ⚠️ Gemello web in `web/src/pages/Assenze.tsx`.
 */
export default function ManagerAbsencesScreen() {
  const insets = useSafeAreaInsets();
  const { canAny, ownerId, venues, isMultiVenue } = useOwnerVenues();
  // Con il solo permesso Turni la RLS non restituisce nessuna riga: meglio dirlo
  // che mostrare «Nessuna assenza».
  const canStaff = canAny("can_manage_staff");
  const query = useCompanyAbsences(canStaff);
  const pull = usePullToRefresh(query.refetch);
  const [filters, setFilters] = useState<CompanyAbsenceFilters>(NO_ABSENCE_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  // L'organico serve solo per il filtro per sede.
  const people = useOwnerPeople(isMultiVenue && canStaff ? ownerId : undefined).data;

  const rows = query.data;
  const personOptions = useMemo(() => absencePeopleOf(rows ?? []), [rows]);
  const venueMemberIds = useMemo(
    () =>
      filters.venueId && people
        ? memberIdsInVenue(people, filters.venueId)
        : null,
    [people, filters.venueId]
  );
  const visible = useMemo(
    () => filterCompanyAbsences(rows ?? [], filters, venueMemberIds),
    [rows, filters, venueMemberIds]
  );
  const { pending, upcoming, closed } = useMemo(
    () => groupCompanyAbsences(visible),
    [visible]
  );
  const activeCount = activeAbsenceFilterCount(filters);
  const nameByPerson = useMemo(
    () => new Map(personOptions.map((p) => [p.id, p.name])),
    [personOptions]
  );
  const nameFor = (a: { member_id: string }) =>
    nameByPerson.get(a.member_id) ?? "Persona";

  return (
    <View className="flex-1 bg-bg-0">
      <View className="shrink-0 px-5 pb-6" style={{ paddingTop: insets.top + 8 }}>
        <ScreenHeader eyebrow="Organico" title="Assenze" />
      </View>

      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
          gap: 24,
        }}
        refreshControl={
          <RefreshControl
            tintColor="#EAB54C"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
          />
        }
      >
        {!canStaff ? (
          <EmptyState
            title="Non gestisci l'organico"
            subtitle="Le assenze le vede chi ha il permesso sull'organico. Nel planning trovi comunque chi non è disponibile."
          />
        ) : query.isLoading ? (
          <ListSkeleton variant="person" label="Caricamento assenze…" />
        ) : query.isError ? (
          <QueryError onRetry={() => query.refetch()} />
        ) : (rows ?? []).length === 0 ? (
          <EmptyState
            title="Nessuna assenza"
            subtitle="Le richieste di ferie e permessi arrivano in chat e compaiono qui. Una malattia comunicata a voce la registri dalla scheda della persona."
          />
        ) : (
          <>
            {/* Chiusi di default, come nello storico: tre righe di chip sopra la
                lista la trasformerebbero in una schermata di comandi. */}
            <View className="gap-4">
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => setPanelOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: panelOpen }}
                  className={cn(
                    "flex-row items-center gap-2 rounded-full border px-3.5 py-2",
                    activeCount > 0 || panelOpen
                      ? "border-border-gold bg-bg-2"
                      : "border-border bg-transparent"
                  )}
                >
                  <Icon name="search" size={14} color="#EAB54C" />
                  <Text className="text-[13px] font-sans-semibold text-t1">
                    {activeCount > 0 ? `Filtri (${activeCount})` : "Filtri"}
                  </Text>
                </Pressable>
                {activeCount > 0 ? (
                  <Pressable
                    onPress={() => setFilters(NO_ABSENCE_FILTERS)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text className="text-[13px] font-sans-semibold text-gold">
                      Azzera
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {panelOpen ? (
                <View className="gap-4">
                  <ChipRow label="Tipo">
                    <FilterChip
                      label="Tutti"
                      active={filters.kinds.length === 0}
                      onPress={() => setFilters({ ...filters, kinds: [] })}
                    />
                    {ABSENCE_KINDS.map((k) => (
                      <FilterChip
                        key={k.id}
                        label={k.label}
                        active={filters.kinds.includes(k.id)}
                        onPress={() =>
                          setFilters(toggleAbsenceKind(filters, k.id, ABSENCE_KINDS.length))
                        }
                      />
                    ))}
                  </ChipRow>

                  {isMultiVenue ? (
                    <ChipRow label="Sede">
                      <FilterChip
                        label="Tutte"
                        active={!filters.venueId}
                        onPress={() => setFilters({ ...filters, venueId: null })}
                      />
                      {venues.map((v, i) => (
                        <FilterChip
                          key={v.id}
                          label={v.name}
                          accent={venueAccent(i)}
                          active={filters.venueId === v.id}
                          onPress={() =>
                            setFilters({
                              ...filters,
                              venueId: filters.venueId === v.id ? null : v.id,
                            })
                          }
                        />
                      ))}
                    </ChipRow>
                  ) : null}

                  <ChipRow label="Persona">
                    <FilterChip
                      label="Tutte"
                      active={!filters.personId}
                      onPress={() => setFilters({ ...filters, personId: null })}
                    />
                    {personOptions.map((p) => (
                      <FilterChip
                        key={p.id}
                        label={p.name}
                        active={filters.personId === p.id}
                        onPress={() =>
                          setFilters({
                            ...filters,
                            personId: filters.personId === p.id ? null : p.id,
                          })
                        }
                      />
                    ))}
                  </ChipRow>
                </View>
              ) : null}
            </View>

            {visible.length === 0 ? (
              <EmptyState
                title="Nessuna assenza con questi filtri"
                subtitle="Prova ad azzerarli. Lo storico completo di una persona è nella sua scheda, in Staff."
              />
            ) : (
              <>
                {pending.length > 0 ? (
                  <View>
                    <SectionHeader title={`Da decidere · ${pending.length}`} />
                    <AbsenceList absences={pending} mode="manager" titleFor={nameFor} />
                  </View>
                ) : null}

                <View>
                  <SectionHeader title="In corso e prossime" />
                  {upcoming.length > 0 ? (
                    <AbsenceList absences={upcoming} mode="manager" titleFor={nameFor} />
                  ) : (
                    <Text className="text-sm text-t3">
                      Nessuna assenza approvata in arrivo.
                    </Text>
                  )}
                </View>

                {closed.length > 0 ? (
                  <View>
                    <SectionHeader title="Passate e chiuse" />
                    <AbsenceList absences={closed} mode="manager" titleFor={nameFor} />
                  </View>
                ) : null}
              </>
            )}
          </>
        )}

        {canStaff ? (
          <Text className="text-xs leading-4 text-t3">
            Qui trovi gli ultimi {COMPANY_ABSENCES_DAYS_BACK} giorni: lo storico
            completo di ogni persona è nella sua scheda, in Staff.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
