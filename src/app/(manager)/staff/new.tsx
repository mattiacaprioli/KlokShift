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
import { Pill } from "@/components/ui/Pill";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import {
  useAddPersonToVenue,
  useAddStaffToVenue,
  useFindWaiterByEmail,
  useVenueStaff,
} from "@/features/staff/hooks";
import { usePeopleFromOtherVenues } from "@/features/staff/usePeopleFromOtherVenues";
import { RoleMultiSelect } from "@/features/roles/RoleMultiSelect";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import type { WaiterLookup } from "@/features/staff/api";
import type { Enums } from "@/types/database";

type Mode = "esistente" | "manuale" | "invita";

/**
 * "Dalle tue sedi" compare solo a chi ha più di un locale, e in testa: per un
 * titolare con tre sedi è il modo più frequente di aggiungere qualcuno —
 * riusare una persona che ha già, non inventarne una nuova.
 */
function modesFor(multiVenue: boolean): { id: Mode; label: string }[] {
  const base: { id: Mode; label: string }[] = [
    { id: "manuale", label: "Manuale" },
    { id: "invita", label: "Invita" },
  ];
  return multiVenue
    ? [{ id: "esistente", label: "Dalle tue sedi" }, ...base]
    : base;
}

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

export default function StaffNewScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const userId = session!.user.id;
  const { venue, venues } = useActiveVenue();
  const venueId = venue?.id;
  const multiVenue = venues.length > 1;
  const MODES = modesFor(multiVenue);

  const [mode, setMode] = useState<Mode>(multiVenue ? "esistente" : "manuale");
  const add = useAddStaffToVenue();
  const addExisting = useAddPersonToVenue();
  const setRoles = useSetStaffMemberRoles();
  const reusable = usePeopleFromOtherVenues(userId, venueId);

  // Chi è già in organico: serve a distinguere, su un invito, chi è già dentro
  // da chi ha solo un invito in attesa.
  const staffQuery = useVenueStaff(venueId);
  const existingStatus = new Map<string, Enums<"staff_link_status">>(
    (staffQuery.data ?? [])
      .filter((s): s is typeof s & { waiter_id: string } => !!s.waiter_id)
      .map((s) => [s.waiter_id, s.link_status])
  );

  // Nuova scheda (manuale)
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");
  const [phone, setPhone] = useState("");

  // Dalle tue sedi: persona già del titolare, ruoli e impiego di QUESTA sede
  const [pickedPerson, setPickedPerson] = useState<string | null>(null);
  const [existingType, setExistingType] =
    useState<Enums<"employment_type">>("a_chiamata");
  const [existingRoleIds, setExistingRoleIds] = useState<string[]>([]);

  // Invita per email
  const find = useFindWaiterByEmail();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<WaiterLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [inviteType, setInviteType] = useState<Enums<"employment_type">>("fisso");
  const foundStatus = found ? (existingStatus.get(found.id) ?? null) : null;

  // Già nel tuo organico, ma in un'ALTRA sede. Senza questo avviso l'invito
  // partirebbe davvero e creerebbe una seconda scheda della stessa persona —
  // inutile, perché l'accordo con lei esiste già: basta aggiungerla a questa sede.
  const foundElsewhere =
    found && !foundStatus
      ? reusable.people.find((r) => r.person.waiter_id === found.id)
      : undefined;

  function onAdded(msg: string) {
    toast.show(msg);
    router.back();
  }
  function onAddError() {
    toast.show("Operazione non riuscita. Riprova.", "error");
  }

  /**
   * Una persona che il titolare ha già altrove entra in questa sede senza invito:
   * l'accordo con lui esiste, e l'account (se c'è) è già collegato all'anagrafica —
   * il trigger lo copia da sé sulla scheda nuova. Ruoli e tipo di impiego invece
   * sono di **questa** sede: si può essere fissi a Roma e a chiamata a Milano.
   */
  function addFromOtherVenue() {
    if (!venueId || !pickedPerson) return;
    addExisting.mutate(
      {
        venue_id: venueId,
        person_id: pickedPerson,
        employment_type: existingType,
      },
      {
        onSuccess: (member) =>
          setRoles.mutate(
            { staffMemberId: member.id, roleIds: existingRoleIds },
            {
              onSuccess: () => onAdded("Aggiunto a questa sede"),
              onError: () =>
                toast.show(
                  "Aggiunto, ma i ruoli non sono stati salvati.",
                  "error"
                ),
            }
          ),
        onError: onAddError,
      }
    );
  }

  function addManual() {
    if (!venueId || !name.trim()) return;
    add.mutate(
      {
        ownerId: userId,
        venueId,
        fullName: name.trim(),
        employmentType: empType,
        phone: phone.trim() || null,
      },
      {
        // I ruoli si scrivono dopo l'insert: hanno bisogno dell'id della scheda.
        onSuccess: (member) =>
          setRoles.mutate(
            { staffMemberId: member.id, roleIds },
            {
              onSuccess: () => onAdded("Aggiunto allo staff"),
              onError: () =>
                toast.show(
                  "Scheda creata, ma i ruoli non sono stati salvati.",
                  "error"
                ),
            }
          ),
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
    if (!venueId || !found) return;
    add.mutate(
      {
        ownerId: userId,
        venueId,
        fullName: found.full_name ?? email.trim(),
        employmentType: inviteType,
        waiterId: found.id,
        linkStatus: "pending",
      },
      { onSuccess: () => onAdded("Richiesta inviata"), onError: onAddError }
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
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

        {mode === "esistente" ? (
          <View className="gap-5">
            {reusable.isLoading ? (
              <Text className="text-sm text-t3">Caricamento…</Text>
            ) : reusable.people.length === 0 ? (
              <EmptyState
                title="Nessuno da riusare"
                subtitle="Tutte le persone che hai nelle altre sedi fanno già parte di questo organico. Usa “Manuale” o “Invita” per aggiungerne una nuova."
              />
            ) : (
              <>
                <Text className="text-xs leading-4 text-t3">
                  Persone che hai nelle altre sedi. Aggiungerle qui non richiede un
                  nuovo invito: anagrafica e documenti restano quelli che hai già.
                </Text>

                <View className="gap-2">
                  {reusable.people.map(({ person, venuesLabel }) => {
                    const active = person.id === pickedPerson;
                    return (
                      <Pressable
                        key={person.id}
                        onPress={() => setPickedPerson(active ? null : person.id)}
                        className={cn(
                          "flex-row items-center gap-3 rounded-2xl border px-4 py-3",
                          active
                            ? "border-gold/40 bg-gold/10"
                            : "border-border-2 bg-bg-card"
                        )}
                      >
                        <Avatar
                          uri={person.waiter?.avatar_url ?? undefined}
                          name={person.full_name}
                          size={40}
                        />
                        <View className="flex-1">
                          <Text
                            className={cn(
                              "text-base",
                              active
                                ? "font-sans-semibold text-gold"
                                : "font-sans-medium text-t1"
                            )}
                          >
                            {person.full_name}
                          </Text>
                          <Text className="mt-0.5 text-xs text-t3">
                            {venuesLabel}
                          </Text>
                        </View>
                        {active ? (
                          <Pill label="Scelto" variant="accepted" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>

                {pickedPerson ? (
                  <>
                    <RoleMultiSelect
                      venueId={venueId}
                      value={existingRoleIds}
                      onChange={setExistingRoleIds}
                    />
                    <View className="gap-2">
                      <Mono>Tipo in questa sede</Mono>
                      <TypeChips
                        value={existingType}
                        onChange={setExistingType}
                      />
                    </View>
                    <GoldButton
                      className="mt-1"
                      label={
                        addExisting.isPending
                          ? "Aggiunta…"
                          : "Aggiungi a questa sede"
                      }
                      disabled={addExisting.isPending}
                      onPress={addFromOtherVenue}
                    />
                  </>
                ) : null}
              </>
            )}
          </View>
        ) : mode === "manuale" ? (
          <View className="gap-5">
            <Input
              label="Nome"
              value={name}
              onChangeText={setName}
              placeholder="Es. Marco Rossi"
            />
            <RoleMultiSelect
              venueId={venueId}
              value={roleIds}
              onChange={setRoleIds}
            />
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
              disabled={add.isPending || !name.trim()}
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
                foundStatus === "pending" ? (
                  <Card className="rounded-3xl border-border-2 p-5">
                    <View className="flex-row items-center gap-3">
                      <View className="flex-1">
                        <Text className="text-sm text-t2">
                          Hai già invitato{" "}
                          {found.full_name ?? "questa persona"}.
                        </Text>
                      </View>
                      <Pill label="In attesa di risposta" variant="pending" />
                    </View>
                  </Card>
                ) : foundStatus === "active" ? (
                  <Card className="rounded-3xl border-border-2 p-5">
                    <Text className="text-sm text-t2">
                      {found.full_name ?? "Questa persona"} è già nel tuo
                      staff.
                    </Text>
                  </Card>
                ) : foundElsewhere ? (
                  <Card className="gap-4 rounded-3xl border-border-2 p-5">
                    <Text className="text-sm leading-5 text-t2">
                      {found.full_name ?? "Questa persona"} è già nel tuo
                      organico a{" "}
                      <Text className="font-sans-semibold text-t1">
                        {foundElsewhere.venuesLabel}
                      </Text>
                      . Aggiungila a questa sede senza rifare l&apos;invito:
                      tiene anagrafica e documenti che ha già.
                    </Text>
                    <GoldButton
                      label="Aggiungi a questa sede"
                      onPress={() => {
                        setPickedPerson(foundElsewhere.person.id);
                        setMode("esistente");
                      }}
                    />
                  </Card>
                ) : (
                  <Card className="rounded-3xl border-border-2 p-5">
                    <View className="flex-row items-center gap-3">
                      <Avatar
                        uri={found.avatar_url ?? undefined}
                        name={found.full_name ?? "Cameriere"}
                        size={48}
                      />
                      <View className="flex-1">
                        <Text className="text-base font-sans-bold text-t1">
                          {found.full_name ?? "Cameriere"}
                        </Text>
                        {found.city ? (
                          <Text className="text-xs text-t3">{found.city}</Text>
                        ) : null}
                      </View>
                    </View>
                    <View className="mt-4 gap-2">
                      <Mono>Tipo</Mono>
                      <TypeChips value={inviteType} onChange={setInviteType} />
                    </View>
                    <GoldButton
                      className="mt-4"
                      label={add.isPending ? "Invio…" : "Invia richiesta"}
                      disabled={add.isPending}
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
