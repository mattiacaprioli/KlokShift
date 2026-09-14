import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useRemoveStaffMember,
  useStaffPerson,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import { PersonHoursSection } from "@/features/assignments/PersonHoursSection";
import { PersonPerformanceSection } from "@/features/assignments/PersonPerformanceSection";
import { ProLockedCard } from "@/features/plan/ProLock";
import { useIsPro } from "@/features/plan/hooks";
import { DocumentsSection } from "@/features/documents/DocumentsSection";
import { RoleMultiSelect } from "@/features/roles/RoleMultiSelect";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import {
  CONTRACT_PERIOD_SHORT,
  CONTRACT_PERIODS,
  personContract,
  type ContractPeriod,
} from "@/features/staff/contract";
import type {
  PersonMembership,
  StaffPersonDetail,
} from "@/features/staff/api";
import type { Enums } from "@/types/database";

/**
 * Una sede in cui la persona lavora.
 *
 * Ha un **Salva suo**, e non è pigrizia: "a Milano fa il Barman ed è a chiamata"
 * non ha niente a che vedere col suo numero di telefono, che vale in tutte le
 * sedi. Prima un solo bottone faceva tre scritture su tre livelli e il commento
 * spiegava l'ordine *perché una poteva cadere lasciando le altre salvate*; con N
 * sedi diventerebbero 1+2N e «quale pezzo è rimasto indietro» una lotteria.
 */
function WorkplaceCard({
  person,
  membership,
  /** Unica sede: la rimozione sta nel bottone globale in fondo alla pagina. */
  isOnly,
}: {
  person: StaffPersonDetail;
  membership: PersonMembership;
  isOnly: boolean;
}) {
  const toast = useToast();
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const remove = useRemoveStaffMember();

  const [roleIds, setRoleIds] = useState<string[]>(
    membership.staff_member_roles
      .map((r) => r.role?.id)
      .filter((id): id is string => !!id)
  );
  const [empType, setEmpType] = useState<Enums<"employment_type">>(
    membership.employment_type
  );
  const [confirmVisible, setConfirmVisible] = useState(false);

  const venueName = membership.venue?.name ?? "Locale";
  const busy = update.isPending || setRoles.isPending || remove.isPending;
  /** Appartenenza finita: resta per lo storico, non si modifica più. */
  const left = membership.link_status === "left";

  async function onSave() {
    try {
      await update.mutateAsync({
        id: membership.id,
        fields: { employment_type: empType },
      });
    } catch {
      toast.show("Tipo di impiego non salvato. Riprova.", "error");
      return;
    }
    try {
      await setRoles.mutateAsync({ staffMemberId: membership.id, roleIds });
    } catch {
      toast.show("Ruoli non salvati. Riprova.", "error");
      return;
    }
    toast.show(`${venueName} aggiornato`);
  }

  function doRemove() {
    remove.mutate(membership.id, {
      onSuccess: () => {
        setConfirmVisible(false);
        toast.show(`Rimosso da ${venueName}`);
      },
      onError: () => {
        setConfirmVisible(false);
        toast.show("Impossibile rimuovere. Riprova.", "error");
      },
    });
  }

  // Chi non c'è più: la sede resta in scheda perché le sue ore sono lì, ma
  // ruoli, tipo di impiego e rimozione non hanno più un oggetto su cui agire.
  // Per riprenderlo lo si riaggiunge dall'organico (Staff → + Aggiungi): con la
  // stessa persona e la stessa sede si rianima **questa** riga invece di
  // crearne una seconda, vedi `addStaffToVenues`.
  if (left) {
    return (
      <View className="gap-2 rounded-3xl border border-border bg-bg-card p-5 opacity-70">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-base font-sans-semibold text-t2">
            {venueName}
          </Text>
          <Pill label="Non più in organico" variant="closed" />
        </View>
        <Text className="text-sm text-t3">
          {membership.left_at
            ? `Ha lasciato questa sede il ${formatDate(membership.left_at.slice(0, 10))}. Le ore dei turni già fatti restano nel rendiconto.`
            : "Le ore dei turni già fatti restano nel rendiconto."}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-base font-sans-semibold text-t1">
          {venueName}
        </Text>
        {membership.link_status === "pending" ? (
          <Pill label="Invito in attesa" variant="pending" />
        ) : null}
        {membership.venue?.closed_at ? (
          <Pill label="Sede chiusa" variant="closed" />
        ) : null}
      </View>

      {/* I ruoli sono di QUESTA sede: `venue_roles` non attraversa i locali. */}
      <RoleMultiSelect
        venueId={membership.venue_id}
        value={roleIds}
        onChange={setRoleIds}
      />

      <View className="gap-2">
        <Mono>Tipo in questa sede</Mono>
        <View className="flex-row gap-2">
          <Chip
            label="Fisso"
            active={empType === "fisso"}
            gold={empType === "fisso"}
            onPress={() => setEmpType("fisso")}
          />
          <Chip
            label="A chiamata"
            active={empType === "a_chiamata"}
            onPress={() => setEmpType("a_chiamata")}
          />
        </View>
      </View>

      <GoldButton
        label={busy ? "Salvataggio…" : "Salva"}
        disabled={busy}
        onPress={() => void onSave()}
      />

      {!isOnly ? (
        <Pressable
          disabled={busy}
          onPress={() => setConfirmVisible(true)}
          className="items-center py-1"
        >
          <Text className="text-sm font-sans-semibold text-error">
            Rimuovi da {venueName}
          </Text>
        </Pressable>
      ) : null}

      <ConfirmModal
        visible={confirmVisible}
        title={`Rimuovere da ${venueName}?`}
        // Da 20260914102811 non è più una cancellazione: l'appartenenza passa a
        // `link_status = 'left'`, quindi le ore già lavorate restano nel
        // rendiconto e nell'export. Spariscono solo i turni **futuri**, che
        // altrimenti resterebbero assegnati a chi non lavora più lì.
        message={`${person.full_name} non sarà più in organico a ${venueName}. I turni futuri già assegnati vengono annullati e tornano da coprire; le ore dei turni passati restano nel rendiconto. Resta nel tuo organico nelle altre sedi.`}
        confirmLabel="Rimuovi"
        destructive
        pending={remove.isPending}
        onConfirm={doRemove}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

/** Anagrafica della persona: vale in tutte le sedi, quindi una sola scrittura. */
function PersonIdentityForm({ person }: { person: StaffPersonDetail }) {
  const toast = useToast();
  const update = useUpdateStaffPerson();
  const [name, setName] = useState(person.full_name);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [note, setNote] = useState(person.note ?? "");

  async function onSave() {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({
        id: person.id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          note: note.trim() || null,
        },
      });
      toast.show("Anagrafica aggiornata");
    } catch {
      toast.show("Impossibile salvare. Riprova.", "error");
    }
  }

  return (
    <View className="gap-5">
      <Mono>Anagrafica</Mono>
      <Input
        label="Nome"
        value={name}
        onChangeText={setName}
        placeholder="Es. Marco Rossi"
      />
      <Input
        label="Telefono (facoltativo)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="Es. 333 1234567"
      />
      <Input
        label="Note (facoltative)"
        value={note}
        onChangeText={setNote}
        placeholder="Es. disponibile nei weekend"
        multiline
        numberOfLines={3}
        className="h-20"
        textAlignVertical="top"
      />
      <GoldButton
        label={update.isPending ? "Salvataggio…" : "Salva anagrafica"}
        disabled={update.isPending || !name.trim()}
        onPress={() => void onSave()}
      />
    </View>
  );
}

/**
 * Le ore da contratto: quante ne deve fare, e su che periodo.
 *
 * Sulla persona come l'anagrafica, perché il contratto lo firma l'azienda: chi
 * lavora in due sedi ha un monte ore solo. Da qui esce il confronto nella
 * colonna ore della vista "persone" del planning web; nessun turno viene
 * bloccato, né qui né lì.
 */
function PersonContractForm({ person }: { person: StaffPersonDetail }) {
  const toast = useToast();
  const update = useUpdateStaffPerson();
  const contract = personContract(person);
  const [hours, setHours] = useState(
    contract ? String(contract.hours).replace(".", ",") : ""
  );
  const [period, setPeriod] = useState<ContractPeriod>(
    contract?.period ?? "week"
  );

  // Campo di testo e non numerico puro: su una tastiera italiana i decimali si
  // scrivono con la virgola, e "37,5" non deve diventare NaN e cancellare in
  // silenzio il contratto.
  const parsed = hours.trim() ? Number(hours.trim().replace(",", ".")) : null;
  const invalid =
    parsed != null && (!Number.isFinite(parsed) || parsed <= 0 || parsed > 400);

  async function onSave() {
    if (invalid) return;
    try {
      await update.mutateAsync({
        id: person.id,
        // Campo vuoto = nessun contratto: le due colonne si azzerano insieme,
        // come impone `staff_people_contract_pair_ck`.
        fields:
          parsed == null
            ? { contract_hours: null, contract_period: null }
            : { contract_hours: parsed, contract_period: period },
      });
      toast.show(parsed == null ? "Contratto rimosso" : "Contratto aggiornato");
    } catch {
      toast.show("Impossibile salvare. Riprova.", "error");
    }
  }

  return (
    <View className="gap-5">
      <Mono>Contratto</Mono>
      <View className="gap-2">
        <Input
          label="Ore da contratto (facoltative)"
          value={hours}
          onChangeText={setHours}
          keyboardType="decimal-pad"
          placeholder="Es. 40"
        />
        {invalid ? (
          <Text className="text-xs text-error">Un numero fra 0 e 400.</Text>
        ) : null}
      </View>
      <View className="gap-2">
        <Mono>Periodo</Mono>
        <View className="flex-row flex-wrap gap-2">
          {CONTRACT_PERIODS.map((p) => (
            <Chip
              key={p}
              label={CONTRACT_PERIOD_SHORT[p]}
              active={period === p}
              gold={period === p}
              onPress={() => setPeriod(p)}
            />
          ))}
        </View>
      </View>
      <Text className="text-xs leading-4 text-t3">
        Quante ore deve fare. Servono a confrontarle con i turni che programmi:
        non bloccano niente. Lascia vuoto se non vuoi il confronto.
      </Text>
      <GoldButton
        label={update.isPending ? "Salvataggio…" : "Salva contratto"}
        disabled={update.isPending || invalid}
        onPress={() => void onSave()}
      />
    </View>
  );
}

/**
 * La scheda di un dipendente: **una per persona**, non una per sede.
 *
 * Prima Marco, che lavora a Roma e a Milano, aveva due URL e due schede, e ognuna
 * mostrava le ore della sola sede da cui l'avevi aperta — un'assenza a Milano non
 * scalfiva il 100% di affidabilità di Roma. Ore, presenze e affidabilità sono
 * dell'azienda; ruoli e tipo di impiego restano della sede, e stanno in "Dove
 * lavora".
 *
 * ⚠️ Il parametro `id` è un **`staff_people.id`**. La rotta non ha cambiato nome,
 * quindi il compilatore non aiuta: un call site rimasto su `staff_members.id`
 * compila, gira e mostra "non trovato" — tranne per le persone nate senza account,
 * dove i due id coincidono per costruzione del backfill (20260913100000) e
 * funziona *per caso*. Chi tocca la navigazione qui provi su una persona
 * **collegata a un account**.
 */
function StaffPersonView({ person }: { person: StaffPersonDetail }) {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const managerId = session!.user.id;
  const isPro = useIsPro();
  const remove = useRemoveStaffMember();
  const startConversation = useStartConversation();
  const [confirmVisible, setConfirmVisible] = useState(false);

  const waiterId = person.waiter_id;
  const memberships = person.memberships;
  // Le sedi dove lavora **adesso**. Le altre restano in elenco (sono lo storico
  // delle sue ore) ma non contano per "in quante sedi lavora" né per le azioni.
  const liveMemberships = memberships.filter((m) => m.link_status !== "left");
  const multiVenue = liveMemberships.length > 1;

  function onMessage() {
    if (!waiterId) return;
    startConversation.mutate(
      { waiterId, managerId },
      {
        onSuccess: (conv) => router.push(`/(manager)/chat/${conv.id}`),
        onError: () =>
          toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  /**
   * Rimozione totale: una scrittura per appartenenza. L'ultima fa scattare
   * `staff_members_zz_orphan_person`, che cancella la persona e con lei i
   * documenti.
   */
  async function doRemoveAll() {
    try {
      // Solo le sedi in cui è ancora in organico: `remove_staff_member` rifiuta
      // una riga già 'left' (`not allowed`), e il ciclo si fermerebbe lì
      // mostrando un errore per un lavoro in realtà già fatto.
      for (const m of liveMemberships) await remove.mutateAsync(m.id);
      setConfirmVisible(false);
      toast.show("Rimosso dall'organico");
      router.back();
    } catch {
      setConfirmVisible(false);
      toast.show("Impossibile rimuovere. Riprova.", "error");
    }
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
        {/* "Dipendente" e non "Staff": la scheda non è più di una sede. */}
        <ScreenHeader eyebrow="Dipendente" title={person.full_name} />

        {waiterId ? (
          <Pressable
            onPress={() => router.push(`/(manager)/cameriere/${waiterId}`)}
          >
            <View className="flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-card px-4 py-3.5">
              <Icon name="verified" size={18} color="#EAB54C" />
              <View className="flex-1">
                <Mono gold>Account app collegato</Mono>
                <Text className="mt-0.5 text-sm text-t2">
                  Vedi profilo ed esperienze
                </Text>
              </View>
              <Icon name="chevR" size={18} color="#8c857a" />
            </View>
          </Pressable>
        ) : null}

        {waiterId ? (
          <Pressable
            disabled={startConversation.isPending}
            onPress={onMessage}
            className="-mt-2 flex-row items-center justify-center gap-2 rounded-2xl border border-border-2 bg-bg-2 py-3.5"
          >
            <Icon name="message" size={16} color="#EAB54C" />
            <Text className="text-sm font-sans-semibold text-t1">
              {startConversation.isPending
                ? "Apertura chat…"
                : "Invia messaggio"}
            </Text>
          </Pressable>
        ) : null}

        {isPro ? (
          <>
            <PersonHoursSection personId={person.id} showVenue={multiVenue} />
            <PersonPerformanceSection
              personId={person.id}
              waiterId={waiterId}
            />
          </>
        ) : (
          <ProLockedCard
            title="Ore e performance"
            subtitle="Ore lavorate, affidabilità e statistiche di questa persona, su tutte le tue sedi."
          />
        )}

        <DocumentsSection
          personId={person.id}
          onAdd={() =>
            router.push({
              pathname: "/(manager)/staff/documento/new",
              params: { personId: person.id },
            })
          }
        />

        <PersonIdentityForm person={person} />

        <PersonContractForm person={person} />

        <View className="gap-3">
          <Mono>
            {multiVenue
              ? `Dove lavora · ${liveMemberships.length}`
              : "Dove lavora"}
          </Mono>
          {memberships.map((m) => (
            <WorkplaceCard
              key={m.id}
              person={person}
              membership={m}
              isOnly={!multiVenue}
            />
          ))}
        </View>

        <Pressable
          disabled={remove.isPending}
          onPress={() => setConfirmVisible(true)}
          className="items-center rounded-2xl border border-border-2 py-3.5"
        >
          <Text className="text-sm font-sans-semibold text-error">
            Rimuovi dall&apos;organico
          </Text>
        </Pressable>
      </ScrollView>

      <ConfirmModal
        visible={confirmVisible}
        title="Rimuovere dall'organico?"
        message={`${person.full_name} non lavorerà più in nessuna delle tue sedi. I turni futuri già assegnati vengono annullati; ore, presenze e documenti restano nella sua scheda e nell'export. Per riprenderlo in futuro basta riaggiungerlo dall'organico.`}
        confirmLabel="Rimuovi"
        destructive
        pending={remove.isPending}
        onConfirm={() => void doRemoveAll()}
        onCancel={() => setConfirmVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

export default function StaffPersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personQuery = useStaffPerson(id);
  const person = personQuery.data ?? null;

  if (personQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-0">
        <ActivityIndicator color="#EAB54C" />
      </View>
    );
  }

  if (personQuery.isError) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <QueryError onRetry={() => personQuery.refetch()} />
      </View>
    );
  }

  if (!person) {
    return (
      <View className="flex-1 bg-bg-0">
        <EmptyState
          title="Scheda non trovata"
          subtitle="Questa persona non fa più parte del tuo organico."
        />
      </View>
    );
  }

  // `key`: i form dentro seedano il loro stato dalle props e non si
  // risincronizzano in un effetto, quindi la persona che cambia va rimontata.
  return <StaffPersonView key={person.id} person={person} />;
}
