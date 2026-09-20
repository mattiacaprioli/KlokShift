import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { useAddSelfToStaff, useAddStaff } from "@/features/staff/hooks";
import { RoleMultiSelect } from "@/features/roles/RoleMultiSelect";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import type { AddStaffResult } from "@/features/staff/api";
import type { Enums } from "@/types/database";

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
 * Con una sede sola non compare: la risposta è già nota e chiederla sarebbe un
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
 *
 * Dal 16/09/2026 è sparito anche il bivio «Manuale / Invita»: chiedeva al
 * titolare se quella persona avesse già KlokShift, cosa che non può sapere.
 * Scrive nome ed email, e `addStaff` decide — scheda, invito in-app o email
 * d'invito. Vedi `src/features/staff/api.ts`.
 *
 * Dal 17/09/2026 la stessa schermata serve anche a **mettere sé stessi** in
 * organico (`?self=1`): chi gestisce la sede spesso ci lavora, e finché non ha
 * una scheda le sue ore non esistono in nessun conto. Una modalità e non una
 * rotta nuova, perché tutto quello che viene dopo il nome — sedi, tipo di
 * impiego, ruoli — è identico; cambiano il nome (è il suo, e non si scrive) e
 * l'email (non serve: l'account si conosce già).
 */
export default function StaffNewScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  // `?self=1` dalla tab Staff. Una stringa e non un booleano: è quello che
  // passa per l'URL.
  const { self } = useLocalSearchParams<{ self?: string }>();
  const isSelf = self === "1";
  const { profile } = useAuth();
  // ⚠️ L'azienda, non chi sta scrivendo: per un collaboratore `session.user.id`
  // non è l'azienda, e la persona appartiene a quest'ultima. Vedi
  // `OwnerVenuesProvider`.
  const { workspaceId, venuesWith } = useOwnerVenues();
  // Solo le sedi in cui si può gestire l'organico: un collaboratore con i soli
  // turni non deve trovare fra i chip una sede su cui l'insert verrebbe
  // rifiutato dalla RLS.
  const venues = venuesWith("can_manage_staff");
  const isMultiVenue = venues.length > 1;
  // L'ultima sede usata — la stessa del form turno: chi sta organizzando Milano
  // la trova già spuntata.
  const { venueId: lastVenueId } = useLastVenue();

  const add = useAddStaff();
  const addSelf = useAddSelfToStaff();
  const pending = add.isPending || addSelf.isPending;

  /**
   * Le sedi scelte. `null` finché la preferenza non è risolta: derivarle invece
   * di inizializzarle a `lastVenueId` evita di dover risincronizzare con un
   * effect quando la preferenza arriva dal disco un render dopo.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const venueIds = picked ?? new Set(lastVenueId ? [lastVenueId] : []);

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

  // Mettendosi da sé il nome è il proprio: si prende dal profilo e resta in
  // sola lettura. Cambiarlo qui scriverebbe un secondo nome sulla stessa
  // persona — quello dell'anagrafica si modifica dal profilo.
  const [name, setName] = useState(() =>
    isSelf ? (profile?.full_name ?? "") : ""
  );
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");
  const [phone, setPhone] = useState("");

  /**
   * La persona era già in organico. Non è un errore da toast: l'accordo con lei
   * esiste, basta aprirla e aggiungerle la sede — nome, documenti e ore restano
   * quelli che ha già.
   */
  const [already, setAlready] = useState<string | null>(null);

  function messageFor(res: AddStaffResult): string {
    if (res.kind === "app_invite") return "Richiesta inviata";
    if (res.kind === "email_invite") {
      if (res.emailSent) return "Aggiunto allo staff · invito spedito";
      return res.emailError
        ? `Aggiunto allo staff · invito non spedito: ${res.emailError}`
        : "Aggiunto allo staff · invito non spedito, riprova dalla sua scheda";
    }
    return "Aggiunto allo staff";
  }

  /**
   * Quel che viene dopo, uguale per le due modalità: il toast e l'uscita.
   *
   * ⚠️ I ruoli non sono più un secondo passo: viaggiano dentro `add_member`,
   * che li scrive nella stessa transazione della scheda. Prima erano un
   * `setStaffMemberRoles` dopo l'insert, e se falliva restava una persona senza
   * mansioni con un messaggio d'errore che non diceva cosa fare.
   */
  function finish(msg: string) {
    toast.show(singleVenue || roleIds.length === 0 ? msg : `${msg} · assegna le mansioni in ogni sede`);
    router.back();
  }

  function submit() {
    if (!workspaceId || venueIds.size === 0 || !name.trim()) return;
    setAlready(null);

    // Le mansioni sono **per sede**: con più sedi la stessa lista non varrebbe
    // per tutte, e si assegnano dopo dalla scheda.
    const roles = singleVenue && roleIds.length > 0 ? roleIds : undefined;

    if (isSelf) {
      addSelf.mutate(
        {
          workspaceId,
          venueIds: [...venueIds],
          employmentType: empType,
          phone: phone.trim() || null,
          roleIds: roles,
        },
        {
          onSuccess: () => finish("Sei in organico"),
          onError: (e) => toast.show(userErrorMessage(e), "error"),
        }
      );
      return;
    }

    add.mutate(
      {
        workspaceId,
        venueIds: [...venueIds],
        fullName: name.trim(),
        employmentType: empType,
        phone: phone.trim() || null,
        email: email.trim() || null,
        roleIds: roles,
      },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            setAlready(res.personId);
            return;
          }
          finish(messageFor(res));
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  if (venues.length === 0) {
    return (
      <View
        className="flex-1 bg-bg-0 px-5"
        style={{ paddingTop: insets.top + 8 }}
      >
        <ScreenHeader eyebrow="Staff" title={isSelf ? "Sei tu" : "Aggiungi"} />
        <NoVenuesState subtitle="Ti serve una sede prima di creare il tuo organico." />
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
        <ScreenHeader eyebrow="Staff" title={isSelf ? "Sei tu" : "Aggiungi"} />

        <View className="gap-5">
          {isSelf ? (
            <Text className="text-sm leading-5 text-t2">
              Ti aggiungi al tuo organico: da qui in poi puoi assegnarti i turni
              come a chiunque altro, e le tue ore entrano nel riepilogo e
              nell&apos;export.
            </Text>
          ) : null}

          {/* Il proprio nome non si scrive qui: è quello del profilo, e
              scriverne un altro creerebbe due nomi per la stessa persona. */}
          {isSelf ? (
            <View className="gap-2">
              <Mono>Nome</Mono>
              <Card className="rounded-3xl border-border-2 px-4 py-3.5">
                <Text className="text-base text-t1">
                  {name || "Il tuo nome"}
                </Text>
              </Card>
              <Text className="text-xs leading-4 text-t3">
                Come compari nel tuo profilo. Si cambia da lì.
              </Text>
            </View>
          ) : (
            <Input
              label="Nome"
              value={name}
              onChangeText={setName}
              placeholder="Es. Marco Rossi"
            />
          )}

          {/* Nessuna email in modalità «sono io»: non c'è nessun invito da
              mandare e nessun account da agganciare — è già il mio. */}
          {isSelf ? null : (
            <View className="gap-2">
              <Input
                label="Email (facoltativa)"
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setAlready(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="nome@email.com"
              />
              <Text className="text-xs leading-4 text-t3">
                Se ha già un account, gli arriva la richiesta nell&apos;app.
                Altrimenti gli mandiamo un invito e, quando si registra con
                questa email, lo colleghiamo a questa scheda.
              </Text>
            </View>
          )}

          {already ? (
            <Card className="gap-4 rounded-3xl border-border-2 p-5">
              <Text className="text-sm leading-5 text-t2">
                Questa persona è già nel tuo organico. Aprila per aggiungerle una
                sede o cambiarle i ruoli: anagrafica e documenti restano quelli
                che ha già.
              </Text>
              <GoldButton
                label="Apri la scheda"
                onPress={() => router.replace(`/(manager)/staff/${already}`)}
              />
            </Card>
          ) : null}

          {isMultiVenue ? (
            <VenueMultiSelect
              venues={venues}
              value={venueIds}
              onToggle={toggleVenue}
            />
          ) : null}

          {/* Solo con una sede sola: i ruoli appartengono alla sede, e
              chiederli per tre sedi in un form di creazione lo renderebbe
              illeggibile. Con più sedi si assegnano dalla scheda persona. */}
          {singleVenue ? (
            <RoleMultiSelect
              venueId={singleVenue}
              value={roleIds}
              onChange={setRoleIds}
            />
          ) : (
            <Text className="text-xs leading-4 text-t3">
              I ruoli cambiano da una sede all&apos;altra: li assegnerai dalla
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
            label={
              pending
                ? "Aggiunta…"
                : isSelf
                  ? "Mettimi in organico"
                  : "Aggiungi allo staff"
            }
            disabled={pending || !name.trim() || venueIds.size === 0}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
