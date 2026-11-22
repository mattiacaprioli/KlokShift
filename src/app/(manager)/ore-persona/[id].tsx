import { ListSkeleton } from "@/components/ui/Skeleton";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { capitalize, formatHours } from "@/lib/format";
import {
  useHoursToFix,
  useOwnerHoursSummary,
  useWorkspaceSurcharges,
} from "@/features/assignments/hooks";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import { periodFromParams } from "@/features/assignments/hoursPerson";
import {
  HOURS_TO_FIX_TITLE,
  hourToFixLabel,
  hourToFixWhen,
} from "@/features/assignments/hoursToFix";
import {
  breakSummaryText,
  monthlyReportRows,
} from "@/features/assignments/monthlyReport";
import { filterByPeople, periodLabel } from "@/features/assignments/reportPeriod";
import { surchargeSummary } from "@/features/assignments/surcharges";
import { useOwnerAbsenceSummary } from "@/features/absences/hooks";
import { formatSummaryDays } from "@/features/absences/summary";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useColors } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

/**
 * Le ore di una persona nel periodo scelto nella pagina Ore: tutto il
 * dettaglio che lì, sul telefono, era un muro di righe piccole (spec
 * 2026-11-22-ore-mobile-leggibile-design.md). Stessi hook e stesse regole
 * della pagina Ore, con lo stesso periodo: i numeri sono quelli della riga.
 */
export default function PersonHoursScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    mese?: string;
    dal?: string;
    al?: string;
  }>();
  const id = params.id;
  const period = periodFromParams(params);
  const { workspaceId, canAny, isMultiVenue } = useOwnerVenues();

  const query = useOwnerHoursSummary(workspaceId, period);
  const absenceQuery = useOwnerAbsenceSummary(workspaceId, period);
  const toFix = (useHoursToFix(workspaceId, period).data ?? []).filter(
    (item) => item.member_id === id
  );
  const surchargeRows =
    useWorkspaceSurcharges(
      canAny("can_view_hours") ? workspaceId : undefined,
      period
    ).data?.rows ?? [];

  const people = groupHoursByPerson(filterByPeople(query.data ?? [], [id]));
  const absences = filterByPeople(absenceQuery.data ?? [], [id]);
  const row = monthlyReportRows(people, absences)[0];
  const absence = absences[0];
  const surcharges = surchargeSummary(surchargeRows, id);
  const breaks = row ? breakSummaryText(row, formatHours) : null;
  const loading = query.isLoading || absenceQuery.isLoading;
  const failed = query.isError || absenceQuery.isError;

  return (
    <View className="flex-1 bg-bg-0">
      <View className="shrink-0 px-5 pb-5" style={{ paddingTop: insets.top + 8 }}>
        <ScreenHeader
          eyebrow={periodLabel(period)}
          title={row?.person_name ?? absence?.person_name ?? "Ore"}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg0 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
          gap: 20,
        }}
      >
        {loading ? (
          <ListSkeleton variant="person" label="Caricamento ore…" />
        ) : failed ? (
          <QueryError
            onRetry={() => {
              query.refetch();
              absenceQuery.refetch();
            }}
          />
        ) : !row ? (
          <EmptyState
            title="Nessuna ora in questo periodo"
            subtitle="Questa persona non ha turni né assenze nel periodo scelto."
          />
        ) : (
          <>
            <View>
              <Text className="text-sm text-t3">Ore lavorate</Text>
              <Text className="text-4xl font-sans-bold text-gold">
                {formatHours(row.worked_hours)}
              </Text>
              <Text className="mt-1 text-base text-t2">
                {[
                  row.roles,
                  `${row.shifts_count} ${row.shifts_count === 1 ? "turno" : "turni"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>

            {row.conflict_hours > 0 || row.untracked_hours > 0 ? (
              <View
                className="gap-1.5 rounded-3xl border border-warning px-5 py-4"
                style={{ backgroundColor: withAlpha(colors.warning, 0.06) }}
              >
                {row.conflict_hours > 0 ? (
                  <Text className="text-base text-warning">
                    {formatHours(row.conflict_hours)} di assenza da verificare,
                    escluse dal totale.
                  </Text>
                ) : null}
                {row.untracked_hours > 0 ? (
                  <Text className="text-base text-warning">
                    {formatHours(row.untracked_hours)} senza timbratura approvata,
                    escluse dalle ore lavorate.
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Card className="gap-2 rounded-3xl border-border-2 px-5 py-4">
              <Mono>Dettaglio</Mono>
              {breaks ? (
                <Text className="text-base text-t1">{capitalize(breaks)}</Text>
              ) : null}
              {surcharges.map((s) => (
                <Text key={s.label} className="text-base text-t1">
                  di cui {s.label}: {formatHours(s.hours)}
                </Text>
              ))}
              <Text className="text-base text-t1">
                Assenza riconosciuta {formatHours(row.justified_hours)}
              </Text>
              <Text className="text-base font-sans-semibold text-t1">
                Totale ore coperte {formatHours(row.covered_hours)}
              </Text>
            </Card>

            {toFix.length > 0 ? (
              <View className="gap-2">
                <Mono>{HOURS_TO_FIX_TITLE}</Mono>
                {toFix.map((item) => (
                  <Pressable
                    key={item.assignment_id}
                    onPress={() => router.push(`/(manager)/shift/${item.shift_id}`)}
                    accessibilityRole="button"
                    className="flex-row items-center gap-3 rounded-2xl border border-border-2 bg-bg-1 px-4 py-3"
                  >
                    <View className="flex-1">
                      <Text className="text-base text-t1" numberOfLines={1}>
                        {hourToFixWhen(item)}
                        {isMultiVenue ? ` · ${item.venue_name}` : ""}
                      </Text>
                      <Text className="text-sm font-sans-semibold text-warning">
                        {hourToFixLabel(item)}
                      </Text>
                    </View>
                    <Icon name="chevR" size={16} color={colors.t3} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {absence ? (
              <Card className="gap-1.5 rounded-3xl border-border-2 px-5 py-4">
                <Mono>Assenze del periodo</Mono>
                {absence.ferie_days > 0 ? (
                  <Text className="text-base text-t1">
                    Ferie {formatSummaryDays(absence.ferie_days)}
                  </Text>
                ) : null}
                {absence.permesso_days > 0 ? (
                  <Text className="text-base text-t1">
                    Permessi {formatSummaryDays(absence.permesso_days)}
                  </Text>
                ) : null}
                {absence.permesso_hours > 0 ? (
                  <Text className="text-base text-t1">
                    Permessi {formatHours(absence.permesso_hours)}
                  </Text>
                ) : null}
                {absence.malattia_days > 0 ? (
                  <Text className="text-base text-t1">
                    Malattia {formatSummaryDays(absence.malattia_days)}
                  </Text>
                ) : null}
                {absence.inps_protocols ? (
                  <Text className="text-sm text-t3">
                    Certificati medici: {absence.inps_protocols}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            <Pressable
              onPress={() => router.push(`/(manager)/staff/${id}`)}
              accessibilityRole="link"
              className="flex-row items-center justify-center gap-1.5 py-2"
            >
              <Text className="text-base font-sans-semibold text-gold">
                Apri la scheda nel Team
              </Text>
              <Icon name="chevR" size={16} color={colors.gold} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
