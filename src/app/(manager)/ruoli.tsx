import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useToast } from "@/providers/Toast";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenuePicker } from "@/features/venues/VenuePicker";
import { useLastVenue } from "@/features/venues/useLastVenue";
import {
  useArchiveVenueRole,
  useCreateVenueRole,
  useRenameVenueRole,
  useVenueRoles,
} from "@/features/roles/hooks";
import type { VenueRole } from "@/features/roles/api";
import { SUGGESTED_ROLES } from "@/features/staff/roles";

/** Una riga della lista: nome modificabile in linea + archivia. */
function RoleRow({
  role,
  onArchive,
}: {
  role: VenueRole;
  onArchive: () => void;
}) {
  const toast = useToast();
  const rename = useRenameVenueRole();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);

  function save() {
    const next = name.trim();
    if (!next || next === role.name) {
      setName(role.name);
      setEditing(false);
      return;
    }
    rename.mutate(
      { id: role.id, name: next },
      {
        onSuccess: () => setEditing(false),
        onError: () => {
          setName(role.name);
          setEditing(false);
          toast.show("Nome già usato o non valido.", "error");
        },
      }
    );
  }

  if (editing) {
    return (
      <View className="flex-row items-center gap-2 py-1.5">
        <View className="flex-1">
          <Input
            value={name}
            onChangeText={setName}
            autoFocus
            onSubmitEditing={save}
            onBlur={save}
            returnKeyType="done"
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-3 py-3">
      <Pressable className="flex-1" onPress={() => setEditing(true)} hitSlop={8}>
        <Text className="text-base text-t1">{role.name}</Text>
        <Text className="text-xs text-t3">Tocca per rinominare</Text>
      </Pressable>
      <Pressable onPress={() => setEditing(true)} hitSlop={8} className="p-1">
        <Icon name="pencil" size={16} color="#8c857a" />
      </Pressable>
      <Pressable onPress={onArchive} hitSlop={8} className="p-1">
        <Icon name="close" size={18} color="#8c857a" />
      </Pressable>
    </View>
  );
}

export default function VenueRolesScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const venueQuery = useOwnerVenues();
  const { venues, venueById, isMultiVenue } = venueQuery;
  // I ruoli sono **per sede** (`venue_roles.venue_id`), e la sede attiva non
  // esiste più: va chiesta qui. Un selettore in cima e non una sezione per sede
  // tutta in pagina — i nomi si ripetono quasi identici fra sedi, e il campo
  // "Aggiungi un ruolo" dovrebbe comunque sapere a quale sezione appartiene:
  // sarebbe lo stesso selettore, ma nascosto.
  const { venueId, choose } = useLastVenue();
  const venue = venueId ? venueById(venueId) : undefined;

  const rolesQuery = useVenueRoles(venueId);
  const roles = rolesQuery.data ?? [];
  const pull = usePullToRefresh(rolesQuery.refetch);

  const create = useCreateVenueRole();
  const archive = useArchiveVenueRole();
  const [draft, setDraft] = useState("");
  const [toArchive, setToArchive] = useState<VenueRole | null>(null);

  function add(name: string) {
    if (!venueId || !name.trim()) return;
    create.mutate(
      { venueId, name },
      {
        onSuccess: () => setDraft(""),
        onError: () => toast.show("Ruolo già presente o non valido.", "error"),
      }
    );
  }

  function doArchive() {
    if (!toArchive) return;
    archive.mutate(toArchive.id, {
      onSuccess: () => {
        setToArchive(null);
        toast.show("Ruolo eliminato");
      },
      onError: () => {
        setToArchive(null);
        toast.show("Impossibile eliminare. Riprova.", "error");
      },
    });
  }

  // Suggerimenti ancora non presenti: serve a chi parte da zero, e sparisce da
  // solo mano a mano che la lista si riempie.
  const taken = new Set(roles.map((r) => r.name.trim().toLowerCase()));
  const suggestions = SUGGESTED_ROLES.filter((s) => !taken.has(s.toLowerCase()));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            tintColor="#EAB54C"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
          />
        }
      >
        <ScreenHeader eyebrow="Organico" title="Ruoli" />

        <Text className="-mt-3 text-[13px] leading-5 text-t3">
          Le mansioni che assegni al tuo staff e che chiedi sui turni. Scrivi
          quelle che usi davvero: ogni sede ha le sue
          {isMultiVenue && venue ? `, e queste sono quelle di ${venue.name}` : ""}.
        </Text>

        {/* Ogni sede ha il suo elenco: qui si sceglie di quale. */}
        <VenuePicker
          perm="can_manage_venue"
          value={venueId}
          onChange={choose}
          label="Ruoli di quale sede"
          className="-mt-1"
        />

        {venueQuery.isLoading || rolesQuery.isLoading ? (
          <ActivityIndicator color="#EAB54C" className="mt-10" />
        ) : rolesQuery.isError ? (
          <QueryError className="mt-6" onRetry={() => rolesQuery.refetch()} />
        ) : venues.length === 0 ? (
          <NoVenuesState subtitle="Ti serve una sede prima di definirne i ruoli." />
        ) : (
          <>
            <View className="gap-2">
              <Input
                label="Aggiungi un ruolo"
                value={draft}
                onChangeText={setDraft}
                placeholder="Es. Pizzaiolo"
                returnKeyType="done"
                onSubmitEditing={() => add(draft)}
              />
              <GoldButton
                label={create.isPending ? "Aggiungo…" : "Aggiungi"}
                disabled={create.isPending || !draft.trim()}
                onPress={() => add(draft)}
              />
            </View>

            {suggestions.length > 0 ? (
              <View className="gap-2">
                <Mono>Esempi</Mono>
                <View className="flex-row flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <Chip key={s} label={`+ ${s}`} onPress={() => add(s)} />
                  ))}
                </View>
              </View>
            ) : null}

            {roles.length === 0 ? (
              <EmptyState
                title="Nessun ruolo"
                subtitle="Aggiungi le mansioni della tua sede: potrai assegnarle allo staff e chiederle sui turni."
              />
            ) : (
              <View className="gap-1 rounded-3xl border border-border-2 bg-bg-card px-4 py-2">
                {roles.map((r) => (
                  <RoleRow
                    key={r.id}
                    role={r}
                    onArchive={() => setToArchive(r)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={!!toArchive}
        title="Eliminare il ruolo?"
        message={`«${toArchive?.name}» sparirà dalle scelte future. I turni passati e le schede già compilate continueranno a mostrarlo.`}
        confirmLabel="Elimina"
        destructive
        pending={archive.isPending}
        onConfirm={doArchive}
        onCancel={() => setToArchive(null)}
      />
    </KeyboardAvoidingView>
  );
}
