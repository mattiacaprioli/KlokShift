import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import {
  useAddStaffToVenues,
  useFindWaiterByEmail,
  useOwnerPeople,
} from "@/features/staff/hooks";
import { RoleMultiSelect } from "@/features/roles/RoleMultiSelect";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import { personVenueNames, type WaiterLookup } from "@/features/staff/api";
import type { Enums } from "@/types/database";

type Mode = "manuale" | "invita";

const MODES: { id: Mode; label: string }[] = [
  { id: "manuale", label: "Manuale" },
  { id: "invita", label: "Invita" },
];

function TypeChips({
  value,
  onChange,
}: {
  value: Enums<"employment_type">;
  onChange: (v: Enums<"employment_type">) => void;
}) {
  return (
    <View className="flex-row gap-2">
      <Chip
        label="Fisso"
        active={value === "fisso"}
        gold={value === "fisso"}
        onPress={() => onChange("fisso")}
      />
      <Chip
        label="A chiamata"
        active={value === "a_chiamata"}
        onPress={() => onChange("a_chiamata")}
      />
    </View>
  );
}

/**
 * In quali sedi lavora. Multi-selezione, almeno una.
 *
 * Con un locale solo non compare: la risposta è già nota e chiederla sarebbe un
 * passo in più per nulla.
 */
function VenueMultiSelect({
  venues,
  value,
  onToggle,
}: {
  venues: { id: string; name: string }[];
  value: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <View className="gap-2">
      <Mono>In quali sedi</Mono>
      <View className="flex-row flex-wrap gap-2">
        {venues.map((v) => (
          <Chip
            key={v.id}
            label={v.name}
            gold
            active={value.has(v.id)}
            onPress={() => onToggle(v.id)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Aggiungi una persona all'organico.
 *
 * Dal 14/09/2026 si aggiunge **una persona**, non una scheda di sede: prima
 * chi, poi dove. È sparita la modalità «Dalle tue sedi» — esisteva per
 * rimediare al fatto che l'organico era della sede attiva, e riusare qualcuno
 * significava ricopiarlo qui. Ora l'organico è dell'azienda: chi c'è già è già
 * in elenco, e gli si aggiunge una sede dalla sua scheda.
 */
export default function StaffNewScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const userId = session!.user.id;
  const { venues, isMultiVenue } = useOwnerVenues();
  // L'ultima sede usata — la stessa del form turno: chi sta organizzando Milano
  // la trova già spuntata.
  const { venueId: lastVenueId } = useLastVenue();

  const [mode, setMode] = useState<Mode>("manuale");
  const add = useAddStaffToVenues();
  const setRoles = useSetStaffMemberRoles();

  /**
   * Le sedi scelte. `null` finché la preferenza non è risolta: derivarle invece
   * di inizializzarle a `lastVenueId` evita di dover risincronizzare con un
   * effect quando la preferenza arriva dal disco un render dopo.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const venueIds =
    picked ?? new Set(lastVenueId ? [lastVenueId] : []);

  function toggleVenue(id: string) {
    setPicked(() => {
      const next = new Set(venueIds);
      // L'ultima sede non si toglie: una persona senza sedi non esiste (il
      // trigger `delete_orphan_staff_person` la cancellerebbe), e il bottone
      // resterebbe disabilitato senza dire perché.
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  // I ruoli sono **per sede**: con due o più sedi scelte servirebbero due o più
  // selettori, e il form diventerebbe illeggibile. Si assegnano dopo, dalla
  // scheda della persona, che li mostra già sede per sede.
  const singleVenue = venueIds.size === 1 ? [...venueIds][0] : undefined;

  // Chi è già in organico: serve a dire, su un invito, che l'accordo esiste già.
  const people = useOwnerPeople(userId).data ?? [];

  // Nuova scheda (manuale)
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");
  const [phone, setPhone] = useState("");

  // Invita per email
  const find = useFindWaiterByEmail();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<WaiterLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [inviteType, setInviteType] = useState<Enums<"employment_type">>("fisso");

  // Già nel tuo organico. Senza questo avviso l'invito partirebbe davvero e
  // creerebbe una seconda scheda della stessa persona — inutile, perché
  // l'accordo con lei esiste già: basta aprirla e aggiungerle la sede.
  const alreadyHave = found
    ? people.find((p) => p.waiter_id === found.id)
    : undefined;

  function onAdded(msg: string) {
    toast.show(msg);
    router.back();
  }
  function onAddError() {
    toast.show("Operazione non riuscita. Riprova.", "error");
  }

  function addManual() {
    if (venueIds.size === 0 || !name.trim()) return;
    add.mutate(
      {
        ownerId: userId,
        venueIds: [...venueIds],
        fullName: name.trim(),
        employmentType: empType,
        phone: phone.trim() || null,
      },
      {
        // I ruoli si scrivono dopo l'insert: hanno bisogno dell'id della scheda.
        // Solo con una sede sola — altrimenti non sono stati chiesti.
        onSuccess: (members) => {
          if (!singleVenue || roleIds.length === 0 || members.length !== 1) {
            onAdded(
              singleVenue
                ? "Aggiunto allo staff"
                : "Aggiunto allo staff · assegna i ruoli in ogni sede"
            );
            return;
          }
          setRoles.mutate(
            { staffMemberId: members[0].id, roleIds },
            {
              onSuccess: () => onAdded("Aggiunto allo staff"),
              onError: () =>
                toast.show(
                  "Scheda creata, ma i ruoli non sono stati salvati.",
                  "error"
                ),
            }
          );
        },
        onError: onAddError,
      }
    );
  }

  function onSearch() {
    const e = email.trim();
    if (!e) return;
    find.mutate(e, {
      onSuccess: (res) => {
        setFound(res);
        setSearched(true);
      },
      onError: () => toast.show("Ricerca non riuscita. Riprova.", "error"),
    });
  }

  function sendInvite() {
    if (venueIds.size === 0 || !found) return;
    add.mutate(
      {
        ownerId: userId,
        venueIds: [...venueIds],
        fullName: found.full_name ?? email.trim(),
        employmentType: inviteType,
        waiterId: found.id,
        linkStatus: "pending",
      },
      { onSuccess: () => onAdded("Richiesta inviata"), onError: onAddError }
    );
  }

  if (venues.length === 0) {
    return (
      <View
        className="flex-1 bg-bg-0 px-5"
        style={{ paddingTop: insets.top + 8 }}
      >
        <ScreenHeader eyebrow="Staff" title="Aggiungi" />
        <NoVenuesState subtitle="Ti serve un locale prima di creare il tuo organico." />
      </View>
    );
  }

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
      >
        <ScreenHeader eyebrow="Staff" title="Aggiungi" />

        {/* Segmented */}
        <View className="flex-row gap-1 rounded-2xl border border-border bg-bg-card p-1">
          {MODES.map((m) => {
            const active = m.id === mode;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMode(m.id)}
                className={cn(
                  "flex-1 items-center rounded-xl py-2.5",
                  active && "bg-bg-2"
                )}
              >
                <Text
                  className={cn(
                    "text-sm",
                    active ? "font-sans-semibold text-t1" : "text-t3"
                  )}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "manuale" ? (
          <View className="gap-5">
            <Input
              label="Nome"
              value={name}
              onChangeText={setName}
              placeholder="Es. Marco Rossi"
            />

            {isMultiVenue ? (
              <VenueMultiSelect
                venues={venues}
                value={venueIds}
                onToggle={toggleVenue}
              />
            ) : null}

            {/* Solo con una sede sola: i ruoli appartengono al locale, e
                chiederli per tre locali in un form di creazione lo renderebbe
                illeggibile. Con più sedi si assegnano dalla scheda persona. */}
            {singleVenue ? (
              <RoleMultiSelect
                venueId={singleVenue}
                value={roleIds}
                onChange={setRoleIds}
              />
            ) : (
              <Text className="text-xs leading-4 text-t3">
                I ruoli cambiano da un locale all&apos;altro: li assegnerai dalla
                sua scheda, sede per sede.
              </Text>
            )}

            <View className="gap-2">
              <Mono>Tipo</Mono>
              <TypeChips value={empType} onChange={setEmpType} />
            </View>
            <Input
              label="Telefono (facoltativo)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="Es. 333 1234567"
            />
            <GoldButton
              className="mt-1"
              label={add.isPending ? "Aggiunta…" : "Aggiungi allo staff"}
              disabled={add.isPending || !name.trim() || venueIds.size === 0}
              onPress={addManual}
            />
          </View>
        ) : (
          <View className="gap-5">
            <Input
              label="Email del professionista"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setFound(null);
                setSearched(false);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="nome@email.com"
            />
            <GoldButton
              label={find.isPending ? "Ricerca…" : "Cerca"}
              disabled={find.isPending || !email.trim()}
              onPress={onSearch}
            />

            {searched ? (
              found ? (
                alreadyHave ? (
                  <Card className="gap-4 rounded-3xl border-border-2 p-5">
                    <Text className="text-sm leading-5 text-t2">
                      {found.full_name ?? "Questa persona"} è già nel tuo
                      organico
                      {isMultiVenue ? (
                        <>
                          {" "}
                          a{" "}
                          <Text className="font-sans-semibold text-t1">
                            {personVenueNames(alreadyHave).join(", ")}
                          </Text>
                        </>
                      ) : null}
                      . Aprila per aggiungerle una sede o cambiarle i ruoli:
                      anagrafica e documenti restano quelli che ha già.
                    </Text>
                    <GoldButton
                      label="Apri la scheda"
                      onPress={() =>
                        router.replace(`/(manager)/staff/${alreadyHave.id}`)
                      }
                    />
                  </Card>
                ) : (
                  <Card className="rounded-3xl border-border-2 p-5">
                    <View className="flex-row items-center gap-3">
                      <Avatar
                        uri={found.avatar_url ?? undefined}
                        name={found.full_name ?? "Professionista"}
                        size={48}
                      />
                      <View className="flex-1">
                        <Text className="text-base font-sans-bold text-t1">
                          {found.full_name ?? "Professionista"}
                        </Text>
                        {found.city ? (
                          <Text className="text-xs text-t3">{found.city}</Text>
                        ) : null}
                      </View>
                    </View>

                    {isMultiVenue ? (
                      <View className="mt-4">
                        <VenueMultiSelect
                          venues={venues}
                          value={venueIds}
                          onToggle={toggleVenue}
                        />
                      </View>
                    ) : null}

                    <View className="mt-4 gap-2">
                      <Mono>Tipo</Mono>
                      <TypeChips value={inviteType} onChange={setInviteType} />
                    </View>
                    <GoldButton
                      className="mt-4"
                      label={add.isPending ? "Invio…" : "Invia richiesta"}
                      disabled={add.isPending || venueIds.size === 0}
                      onPress={sendInvite}
                    />
                  </Card>
                )
              ) : (
                <EmptyState
                  title="Nessun profilo trovato"
                  subtitle="Controlla che l'email sia esatta e che abbia un account da professionista su topWaitr."
                />
              )
            ) : (
              <Text className="text-xs leading-4 text-t3">
                Inserisci l&apos;email esatta della persona. Riceverà una
                richiesta e, se accetta, entrerà nel tuo organico.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
