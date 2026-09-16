import { useRef, useState, type ReactNode } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView as RNScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { Icon } from "@/components/ui/Icon";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { formatBirthday, formatDate } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useAddPersonToVenue,
  useRemoveStaffMember,
  useSendStaffInvite,
  useStaffPerson,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import { PersonHoursSection } from "@/features/assignments/PersonHoursSection";
import { PersonPerformanceSection } from "@/features/assignments/PersonPerformanceSection";
import { ProLockedCard } from "@/features/plan/ProLock";
import { useIsPro } from "@/features/plan/hooks";
import { PersonAbsencesSection } from "@/features/absences/PersonAbsencesSection";
import { DocumentsSection } from "@/features/documents/DocumentsSection";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { PromoteSection } from "@/features/team/PromoteSection";
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
  /** Può rimettere in organico un'appartenenza finita: vedi `StaffPersonView`. */
  canRestore,
}: {
  person: StaffPersonDetail;
  membership: PersonMembership;
  isOnly: boolean;
  canRestore: boolean;
}) {
  const toast = useToast();
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const remove = useRemoveStaffMember();
  const restore = useAddPersonToVenue();

  const [roleIds, setRoleIds] = useState<string[]>(
    membership.staff_member_roles
      .map((r) => r.role?.id)
      .filter((id): id is string => !!id)
  );
  const [empType, setEmpType] = useState<Enums<"employment_type">>(
    membership.employment_type
  );
  const [confirmVisible, setConfirmVisible] = useState(false);

  const venueName = membership.venue?.name ?? "Sede";
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

  function doRestore() {
    restore.mutate(
      {
        venue_id: membership.venue_id,
        person_id: person.id,
        employment_type: membership.employment_type,
      },
      {
        onSuccess: () => toast.show(`Di nuovo in organico a ${venueName}`),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  // Chi non c'è più: la sede resta in scheda perché le sue ore sono lì, ma
  // ruoli, tipo di impiego e rimozione non hanno più un oggetto su cui agire.
  // Riprenderlo non crea una riga nuova: `addPersonToVenue` rianima questa, con
  // i ruoli che aveva — l'uscita non li cancella. I turni annullati all'uscita
  // invece non tornano.
  if (left) {
    return (
      <View className="gap-4 rounded-3xl border border-border bg-bg-card p-5">
        <View className="gap-2 opacity-70">
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
        {canRestore && !membership.venue?.closed_at ? (
          <GhostButton
            label={restore.isPending ? "Un momento…" : "Rimetti in organico"}
            disabled={restore.isPending}
            onPress={doRestore}
          />
        ) : null}
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

      {/* I ruoli sono di QUESTA sede: `venue_roles` non attraversa le sedi. */}
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

/**
 * Un'altra delle sedi del titolare per una persona che ha già. Nessun invito:
 * l'accordo c'è, e l'account, se c'è, è già sulla persona. I ruoli si scelgono
 * dopo, sulla card che compare, perché sono di quella sede.
 */
function AddToVenueCard({
  person,
  venues,
}: {
  person: StaffPersonDetail;
  venues: { id: string; name: string }[];
}) {
  const toast = useToast();
  const add = useAddPersonToVenue();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [empType, setEmpType] =
    useState<Enums<"employment_type">>("a_chiamata");
  const venue = venues.find((v) => v.id === venueId);

  function onAdd() {
    if (!venue) return;
    add.mutate(
      { venue_id: venue.id, person_id: person.id, employment_type: empType },
      {
        onSuccess: () => {
          setVenueId(null);
          toast.show(`Aggiunto a ${venue.name} · scegli i ruoli nella sua card`);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
      <Text className="text-base font-sans-semibold text-t1">
        Aggiungi a un&apos;altra sede
      </Text>

      <View className="gap-2">
        <Mono>Sede</Mono>
        {/* Orizzontale come in `VenuePicker`: i nomi delle sedi sono liberi, e
            mandarli a capo spezzerebbe la riga in modo diverso a ogni sede. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
        >
          {venues.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              gold
              active={v.id === venueId}
              onPress={() => setVenueId(v.id)}
            />
          ))}
        </ScrollView>
      </View>

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
        label={
          add.isPending
            ? "Aggiunta…"
            : venue
              ? `Aggiungi a ${venue.name}`
              : "Scegli una sede"
        }
        disabled={!venue || add.isPending}
        onPress={onAdd}
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
  const [email, setEmail] = useState(person.email ?? "");
  const [note, setNote] = useState(person.note ?? "");

  async function onSave() {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({
        id: person.id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          // L'email non si tocca più una volta che l'account è collegato:
          // l'indirizzo vero è quello di `auth.users`, e riscriverlo qui
          // cambierebbe solo la rubrica del titolare dando l'idea di poter
          // spostare l'account di qualcun altro.
          ...(person.waiter_id ? {} : { email: email.trim() || null }),
          note: note.trim() || null,
        },
      });
      toast.show("Anagrafica aggiornata");
    } catch (e) {
      // L'unique (owner_id, email) è il vincolo che tiene l'aggancio non
      // ambiguo: vale la pena dirlo meglio del generico «esiste già un
      // elemento con questi dati» a cui lo mapperebbe `userErrorMessage`.
      const msg = e instanceof Error ? e.message : "";
      toast.show(
        msg.includes("staff_people_owner_email_uq")
          ? "Hai già una scheda con questa email."
          : userErrorMessage(e),
        "error"
      );
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
      {person.waiter_id ? null : (
        <Input
          label="Email (facoltativa)"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="nome@email.com"
        />
      )}
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

      <PersonInviteRow person={person} />
      <PersonBirthdayRow person={person} />
    </View>
  );
}

/**
 * A che punto è l'invito: la riga che dice se questa scheda è collegata a un
 * account, e che permette di (ri)spedire l'email.
 *
 * Lo stato non è una colonna: si legge da `email`, `invited_at` e `waiter_id`.
 * Una scheda creata prima che questa feature esistesse entra nel flusso senza
 * migrazione di dati — le si aggiunge un'email e il bottone compare.
 */
function PersonInviteRow({ person }: { person: StaffPersonDetail }) {
  const toast = useToast();
  const send = useSendStaffInvite();

  if (person.waiter_id) {
    return (
      <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-bg-card px-4 py-3">
        <Icon name="check" size={18} color="#7BAE7F" />
        <Text className="flex-1 text-[15px] font-sans-semibold text-t1">
          Account collegato
        </Text>
      </View>
    );
  }

  if (person.invite_conflict_at) {
    return (
      <View className="gap-1 rounded-2xl border border-border bg-bg-card px-4 py-3">
        <Mono>Invito</Mono>
        <Text className="text-sm leading-5 text-t2">
          Questa email appartiene a un account già collegato a un&apos;altra
          scheda del tuo organico. Controlla se sono la stessa persona: in tal
          caso usa quella scheda ed elimina questa.
        </Text>
      </View>
    );
  }

  if (!person.email) return null;

  // Nessun countdown lato client: il limite (uno ogni 15 minuti, 5 in tutto) sta
  // nella RPC `claim_staff_invite_send`, che risponde con un messaggio già
  // pronto. Calcolarlo anche qui vorrebbe dire due verità che possono
  // divergere — e `Date.now()` in render non è puro.
  function onSend() {
    send.mutate(person.id, {
      onSuccess: () => toast.show("Invito mandato"),
      onError: (e) => toast.show(userErrorMessage(e), "error"),
    });
  }

  return (
    <View className="gap-3 rounded-2xl border border-border bg-bg-card px-4 py-3">
      <View className="flex-row items-center gap-3">
        <Icon name="sparkle" size={18} color="#EAB54C" />
        <View className="flex-1">
          <Mono>Invito</Mono>
          <Text className="mt-0.5 text-[15px] font-sans-semibold text-t1">
            {/* Senza participio: «invitato/invitata» imporrebbe un genere che
                il nome sulla scheda non garantisce. */}
            {person.invited_at
              ? `Invito mandato il ${formatDate(person.invited_at)}`
              : "Invito non ancora mandato"}
          </Text>
        </View>
      </View>
      <Text className="text-xs leading-4 text-t3">
        Quando si registrerà con {person.email}, questa scheda diventerà la sua.
      </Text>
      {/* L'etichetta dice l'azione, non il meccanismo: «Invia invito» lasciava
          al titolare il dubbio su cosa arrivi alla persona. */}
      <GhostButton
        label={
          send.isPending
            ? "Invio…"
            : person.invited_at
              ? "Rimanda l'invito"
              : "Invita a scaricare l'app"
        }
        disabled={send.isPending}
        onPress={onSend}
      />
    </View>
  );
}

/**
 * Il compleanno, in sola lettura e sotto al pulsante di salvataggio.
 *
 * Non è un campo del modulo perché **non è un dato del titolare**: lo mette il
 * professionista dal suo profilo, e arriva qui solo se ha scelto di metterlo.
 * Un `Input` disabilitato in mezzo agli altri avrebbe detto che c'è un permesso
 * da sbloccare; una riga separata dice che è roba sua.
 *
 * Giorno e mese, mai l'anno: in `profiles` l'anno non c'è proprio
 * (20260914160000), quindi qui non c'è un'età da mostrare nemmeno volendo.
 * Sparisce quando non è stato messo — una riga «non indicato» inviterebbe a
 * chiederlo, e chiederlo è precisamente ciò che questa colonna evita.
 */
function PersonBirthdayRow({ person }: { person: StaffPersonDetail }) {
  const label = formatBirthday(
    person.waiter?.birth_day ?? null,
    person.waiter?.birth_month ?? null
  );
  if (!label) return null;

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-bg-card px-4 py-3">
      <Icon name="sparkle" size={18} color="#EAB54C" />
      <View className="flex-1">
        <Mono>Compleanno</Mono>
        <Text className="mt-0.5 text-[15px] font-sans-semibold text-t1">
          {label}
        </Text>
      </View>
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

type PersonTab =
  | "dati"
  | "sedi"
  | "ore"
  | "assenze"
  | "documenti"
  | "gestione";

/**
 * Una sezione della scheda. Nascosta e non smontata: vedi `StaffPersonView`.
 * `display` in `style` perché dipende dal tab scelto.
 */
function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <View className="gap-5" style={{ display: active ? "flex" : "none" }}>
      {children}
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
  const [selectedTab, setSelectedTab] = useState<PersonTab>("dati");
  const scrollRef = useRef<RNScrollView>(null);

  const { isOwner, can, canAny, venues } = useOwnerVenues();

  const waiterId = person.waiter_id;
  /**
   * Le sedi della persona che **chi guarda** gestisce.
   *
   * Per il titolare sono tutte. Per un collaboratore no, ed è il punto: la
   * scheda è dell'azienda, ma lui la deve leggere dalla sua sede. Sapere che
   * Marco lavora anche negli altre due sedi del gruppo non gli serve, e la
   * RLS lo lascerebbe vedere (le appartenenze arrivano in un embed sulla
   * persona, che lui può leggere).
   */
  const memberships = isOwner
    ? person.memberships
    : person.memberships.filter((m) => can(m.venue_id, "can_manage_staff"));
  // Le sedi dove lavora **adesso**. Le altre restano in elenco (sono lo storico
  // delle sue ore) ma non contano per "in quante sedi lavora" né per le azioni.
  const liveMemberships = memberships.filter((m) => m.link_status !== "left");
  const multiVenue = liveMemberships.length > 1;
  // Riprendere qualcuno o dargli un'altra sede è del titolare: l'update su
  // `staff_members` la RLS lo concede solo a lui. Con un account, poi, solo se
  // lavora ancora per lui da qualche parte: chi ha lasciato tutte le sedi
  // l'accordo l'ha chiuso, e rimetterlo in organico senza chiederglielo sarebbe
  // decidere al posto suo. Stessa regola della scheda web.
  const canReassign = isOwner && (!waiterId || liveMemberships.length > 0);
  // Le sedi dove non c'è mai stata. Quelle lasciate hanno già la loro card, con
  // il suo «Rimetti in organico».
  const otherVenues = venues.filter(
    (v) => !person.memberships.some((m) => m.venue_id === v.id)
  );

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

  // Una sezione alla volta: impilate, con due sedi la scheda era una colonna
  // di schermate. Un tab compare solo se chi guarda ha qualcosa da farci —
  // stessi permessi che prima nascondevano le sezioni.
  const tabs: { id: PersonTab; label: string }[] = [
    { id: "dati", label: "Dati" },
    { id: "sedi", label: multiVenue ? `Sedi · ${liveMemberships.length}` : "Sedi" },
    ...(canAny("can_view_hours") ? [{ id: "ore" as const, label: "Ore" }] : []),
    // Stesso permesso della RLS di `staff_absences`: la malattia è un dato
    // sanitario, chi fa solo i turni non la legge.
    ...(canAny("can_manage_staff")
      ? [{ id: "assenze" as const, label: "Assenze" }]
      : []),
    ...(canAny("can_manage_documents")
      ? [{ id: "documenti" as const, label: "Documenti" }]
      : []),
    // La promozione è del titolare e di nessun altro: un collaboratore che
    // potesse promuoverne altri sarebbe una catena di deleghe.
    ...(isOwner && waiterId && liveMemberships.length > 0
      ? [{ id: "gestione" as const, label: "Gestione" }]
      : []),
  ];
  // Il tab scelto può sparire a scheda aperta (es. lascia l'ultima sede e
  // «Gestione» non ha più senso): si torna ai dati.
  const tab = tabs.some((t) => t.id === selectedTab) ? selectedTab : "dati";

  function onTabChange(id: PersonTab) {
    setSelectedTab(id);
    // Ogni sezione riparte dall'alto: restare a metà delle ore e trovarsi a
    // metà dei documenti non ha senso.
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0">
        {/* Header e tab restano fermi: a scorrere è solo la sezione. */}
        <View
          className="gap-4 border-b border-border pb-3"
          style={{ paddingTop: insets.top + 8 }}
        >
          <View className="px-5">
            {/* "Dipendente" e non "Staff": la scheda non è più di una sede. */}
            <ScreenHeader
              eyebrow="Dipendente"
              title={person.full_name}
              titleClassName="text-2xl"
              right={
                // La conversazione è la coppia (professionista, titolare) e
                // non è scopata per sede: aprirla come collaboratore creerebbe
                // un thread che il titolare non vede e che al professionista
                // arriva da uno sconosciuto.
                waiterId && isOwner ? (
                  <Pressable
                    disabled={startConversation.isPending}
                    onPress={onMessage}
                    hitSlop={8}
                    accessibilityLabel="Invia messaggio"
                    className="h-12 w-12 items-center justify-center rounded-full border border-border-2 bg-bg-2"
                  >
                    {startConversation.isPending ? (
                      <ActivityIndicator color="#EAB54C" />
                    ) : (
                      <Icon name="message" size={18} color="#EAB54C" />
                    )}
                  </Pressable>
                ) : null
              }
            />
          </View>

          <RNScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          >
            {tabs.map((t) => {
              const active = t.id === tab;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onTabChange(t.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  className={cn(
                    "rounded-full border px-4 py-2",
                    active ? "border-gold bg-gold" : "border-border-2 bg-bg-2"
                  )}
                >
                  <Text
                    className={cn(
                      "text-sm",
                      active ? "font-sans-semibold text-gold-ink" : "text-t2"
                    )}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </RNScrollView>
        </View>

        <RNScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 20,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 48,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* I pannelli inattivi restano montati e solo nascosti: i form tengono
              gli edit in stato locale, e cambiare tab non deve buttarli via. */}
          <TabPanel active={tab === "dati"}>
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
            <PersonIdentityForm person={person} />
            {/* Le ore da contratto sono un accordo fra la persona e l'azienda,
                non un dato della sede: le vede e le cambia solo il titolare. */}
            {isOwner ? <PersonContractForm person={person} /> : null}
          </TabPanel>

          <TabPanel active={tab === "sedi"}>
            <View className="gap-3">
              {memberships.map((m) => (
                <WorkplaceCard
                  key={m.id}
                  person={person}
                  membership={m}
                  isOnly={!multiVenue}
                  canRestore={canReassign}
                />
              ))}
              {canReassign && otherVenues.length > 0 ? (
                <AddToVenueCard person={person} venues={otherVenues} />
              ) : null}
            </View>

            {/* Toglie la persona da **tutte** le sedi dell'azienda, comprese
                quelle che un collaboratore non gestisce. Resta al titolare; il
                delegato la toglie dalla propria sede dalla card qui sopra. */}
            {isOwner ? (
              <Pressable
                disabled={remove.isPending}
                onPress={() => setConfirmVisible(true)}
                className="items-center rounded-2xl border border-border-2 py-3.5"
              >
                <Text className="text-sm font-sans-semibold text-error">
                  Rimuovi dall&apos;organico
                </Text>
              </Pressable>
            ) : null}
          </TabPanel>

          {/* Ore, affidabilità e presenze: dietro il permesso Ore. Senza, le RPC
              tornerebbero comunque zero righe (`get_person_performance` è
              scopata su `my_venue_ids('hours')`) e la scheda mostrerebbe un 0%
              che sembra un dato. */}
          {canAny("can_view_hours") ? (
            <TabPanel active={tab === "ore"}>
              {isPro ? (
                <>
                  <PersonHoursSection
                    personId={person.id}
                    showVenue={multiVenue}
                  />
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
            </TabPanel>
          ) : null}

          {canAny("can_manage_staff") ? (
            <TabPanel active={tab === "assenze"}>
              <PersonAbsencesSection
                personId={person.id}
                onRecord={() =>
                  router.push({
                    pathname: "/(manager)/staff/assenza/new",
                    params: { personId: person.id },
                  })
                }
              />
            </TabPanel>
          ) : null}

          {canAny("can_manage_documents") ? (
            <TabPanel active={tab === "documenti"}>
              <DocumentsSection
                personId={person.id}
                onAdd={() =>
                  router.push({
                    pathname: "/(manager)/staff/documento/new",
                    params: { personId: person.id },
                  })
                }
              />
            </TabPanel>
          ) : null}

          {tabs.some((t) => t.id === "gestione") && waiterId ? (
            <TabPanel active={tab === "gestione"}>
              <PromoteSection
                ownerId={person.owner_id}
                waiterId={waiterId}
                personName={person.full_name}
                venueIds={liveMemberships.map((m) => m.venue_id)}
              />
            </TabPanel>
          ) : null}
        </RNScrollView>
      </View>

      <ConfirmModal
        visible={confirmVisible}
        title="Rimuovere dall'organico?"
        message={`${person.full_name} non lavorerà più in nessuna delle tue sedi. I turni futuri già assegnati vengono annullati; ore, presenze e documenti restano nella sua scheda e nell'export.`}
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
