import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Display } from "@/components/ui/Display";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NavRow } from "@/components/ui/NavRow";
import { StatCard } from "@/components/ui/StatCard";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { useMyWaiterProfile } from "@/features/waiterProfile/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import { useViewMode } from "@/features/team/ViewMode";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLeaveVenue } from "@/features/account/hooks";
import { useMyWorkTotals } from "@/features/assignments/history";
import {
  periodLabel,
  periodRange,
  STATS_PERIODS,
  type StatsPeriod,
} from "@/features/shifts/homeStats";
import type { Membership } from "@/features/workspace/types";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Una sede in cui lavoro: la riga di organico, con l'azienda a cui appartiene. */
type MyEmployer = {
  /** `venue_members.id`. */
  id: string;
  /** La mia appartenenza in quell'azienda (`workspace_members.id`). */
  memberId: string;
  workspaceId: string;
  venueId: string;
  venueName: string;
  employment_type: Membership["works"][number]["employment_type"];
};

/** Le sedi in cui lavoro, dalle mie appartenenze attive (`get_my_context`). */
function employersOf(memberships: Membership[]): MyEmployer[] {
  return memberships
    .filter((m) => m.status === "active")
    .flatMap((m) =>
      m.works.map((w) => ({
        id: w.venue_member_id,
        memberId: m.member_id,
        workspaceId: m.workspace_id,
        venueId: w.venue_id,
        venueName: w.venue_name,
        employment_type: w.employment_type,
      }))
    );
}

/** Una sede dentro la card del datore di lavoro: identità e "Lascia". */
/**
 * «Passa alla gestione», per chi è stato promosso dalla propria sede.
 *
 * Compare solo con un'appartenenza che gestisce (`useViewMode().canSwitch`),
 * quindi per la quasi totalità dei professionisti questa riga non esiste. Cambiare vista non
 * concede niente: i permessi li decide la RLS sede per sede, e questo tocco
 * sceglie soltanto quale gruppo di rotte montare.
 */
function ManagerSwitchRow() {
  const { canSwitch, setMode } = useViewMode();
  const { venues } = useOwnerVenues();
  if (!canSwitch) return null;

  const names = venues.map((v) => v.name).join(", ");
  return (
    <NavRow
      icon="shield"
      title="Passa alla gestione"
      subtitle={names || "Organizza i turni della sede"}
      onPress={() => setMode("manager")}
    />
  );
}

function EmployerVenueRow({
  employer,
  standalone,
}: {
  employer: MyEmployer;
  /** Unica sede di quel datore: niente separatore, "Lascia" nella riga azioni. */
  standalone: boolean;
}) {
  const toast = useToast();
  const leave = useLeaveVenue();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const venueName = employer.venueName || "Sede";

  function onConfirm() {
    leave.mutate(
      { memberId: employer.memberId, venueId: employer.venueId },
      {
        onSuccess: () => {
          setConfirmVisible(false);
          toast.show("Hai lasciato la sede");
        },
        onError: () => {
          setConfirmVisible(false);
          toast.show("Operazione non riuscita. Riprova.", "error");
        },
      }
    );
  }

  return (
    <>
      <View
        className={cn(
          "flex-row items-center gap-3",
          !standalone && "border-t border-border pt-3"
        )}
      >
        <Avatar name={venueName} size={40} />
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1">{venueName}</Text>
        </View>
        <Chip
          label={employer.employment_type === "fisso" ? "Fisso" : "A chiamata"}
          active
          gold={employer.employment_type === "fisso"}
        />
      </View>

      {/* "Lascia" è **della sede**: ci si dimette da un posto di lavoro, non da
          un'azienda intera. Con più sedi sta sotto la riga a cui si riferisce,
          sennò non si capisce quale delle due si sta lasciando. */}
      <Pressable
        onPress={() => setConfirmVisible(true)}
        hitSlop={6}
        className={standalone ? undefined : "mt-2"}
      >
        <Text className="text-sm font-sans-semibold text-error">
          {standalone ? "Lascia la sede" : `Lascia ${venueName}`}
        </Text>
      </Pressable>

      <ConfirmModal
        visible={confirmVisible}
        title={`Lasciare ${venueName}?`}
        // Il nome della sede nel titolo, non "questa sede": un datore di lavoro
        // può averne più di una, e chi si dimette da Milano deve vedere scritto
        // "Milano" prima di confermare.
        // Le due cose che cambiano davvero, dette prima: i turni futuri saltano
        // (e la sede se lo vede scritto nella notifica), il lavoro già fatto
        // resta dov'è. Vedi `leave_venue` in 20260914102811.
        message={`Non farai più parte dello staff di ${venueName}. I turni che hai in programma lì vengono annullati e la sede viene avvisata; le ore che hai già lavorato restano nel tuo storico. Se lavori in altre sedi dello stesso datore di lavoro, quelle restano — e con loro i tuoi documenti.`}
        confirmLabel="Lascia"
        destructive
        pending={leave.isPending}
        onConfirm={onConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </>
  );
}

/**
 * Un **datore di lavoro** e le sue sedi, non una card per sede.
 *
 * ⚠️ La chat è una sola per coppia professionista–titolare (indice unico
 * `conversations_waiter_manager_key`, e vedi 20260913100200: la decisione di
 * prodotto è un filo solo, non uno per edificio). Con due sedi dello stesso
 * titolare c'erano due "Scrivi alla sede" che aprivano **la stessa**
 * conversazione: due bottoni diversi per la stessa cosa, cioè una promessa che
 * il prodotto non mantiene. Qui il bottone è uno, come il filo.
 *
 * Lo stesso raggruppamento che fanno già i documenti (`documentScopeLabel`): la
 * cartella è del datore di lavoro, le sedi le danno solo il nome.
 */
function EmployerGroupCard({ venues }: {
  /** Le sedi di **un** datore di lavoro, dalla più vecchia. */
  venues: MyEmployer[];
}) {
  const toast = useToast();
  const router = useRouter();
  const startConversation = useStartConversation();
  const workspaceId = venues[0].workspaceId;
  const multi = venues.length > 1;

  function onContact() {
    startConversation.mutate(
      { workspaceId },
      {
        onSuccess: (conv) => router.push(`/(waiter)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  return (
    <Card className="gap-3 rounded-3xl border-border-2 p-4">
      {venues.map((employer) => (
        <EmployerVenueRow
          key={employer.id}
          employer={employer}
          standalone={!multi}
        />
      ))}

      {workspaceId ? (
        <View className={multi ? "border-t border-border pt-3" : undefined}>
          <Pressable
            onPress={onContact}
            disabled={startConversation.isPending}
            hitSlop={6}
          >
            <Text className="text-sm font-sans-semibold text-gold">
              {startConversation.isPending
                ? "Apertura…"
                : multi
                  ? "Scrivi al datore di lavoro"
                  : "Scrivi alla sede"}
            </Text>
          </Pressable>
          {multi ? (
            <Text className="mt-1 text-xs text-t3">
              Una chat sola per tutte le sedi di questo datore di lavoro.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Le sedi raggruppate per titolare, nell'ordine in cui sono arrivate. */
function groupByEmployer(employers: MyEmployer[]): MyEmployer[][] {
  const groups = new Map<string, MyEmployer[]>();
  for (const e of employers) {
    const list = groups.get(e.workspaceId);
    if (list) list.push(e);
    else groups.set(e.workspaceId, [e]);
  }
  return [...groups.values()];
}

export default function WaiterProfiloScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const name = profile?.full_name ?? "Cameriere";
  const userId = session!.user.id;

  const profileQuery = useMyWaiterProfile(userId);
  const data = profileQuery.data;
  const wp = data?.waiter_profile ?? null;
  const role = wp?.primary_role ?? null;
  const city = data?.city ?? null;
  const languages = wp?.languages ?? [];

  const { memberships } = useOwnerVenues();
  const employers = employersOf(memberships);
  // Le mie ore sul periodo scelto, come le legge il titolare nella sua home:
  // un totale «da sempre» non dice quanto ho lavorato (quello sta nello Storico).
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const { from, to } = useMemo(() => periodRange(period), [period]);
  const work = useMyWorkTotals(userId, from, to);
  const subtitle = [role, city].filter(Boolean).join(" · ");

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 96,
        gap: 24,
      }}
    >
      {/* Barra: occhiello + impostazioni */}
      <View className="flex-row items-center justify-between">
        <Mono>Profilo</Mono>
        <Pressable
          onPress={() => router.push("/(waiter)/impostazioni")}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="settings" size={19} color="#F8F4ED" />
        </Pressable>
      </View>

      {/* Identità */}
      <View className="items-center gap-4">
        <View
          className="rounded-full"
          style={{
            borderWidth: 2.5,
            borderColor: "#EAB54C",
            padding: 5,
            shadowColor: "#EAB54C",
            shadowOpacity: 0.2,
            shadowRadius: 26,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          <Avatar uri={profile?.avatar_url} name={name} size={104} />
        </View>

        <View className="items-center gap-1.5">
          <View className="flex-row items-center gap-2">
            <Display className="text-4xl">{name}</Display>
            <Icon name="verified" size={22} color="#EAB54C" />
          </View>
          {subtitle ? (
            <Text className="text-sm text-t2">{subtitle}</Text>
          ) : null}
          {/* Le lingue restano qui, sotto al nome, e non in una scheda «il tuo
              profilo»: sono l'unica cosa che sopravvive al CV, e un dato che
              scrivi senza rivederlo mai è un dato che smetti di aggiornare. */}
          {languages.length > 0 ? (
            <Text className="text-xs text-t3">{languages.join(" · ")}</Text>
          ) : null}
        </View>
      </View>

      {/* Con le recensioni spente «Condividi profilo» non ha più un pubblico:
          apriva il QR, che serviva a farsi recensire dai clienti. L'azione
          principale del profilo diventa quella che c'è sempre stata sotto:
          tenere i propri dati aggiornati. */}
      {REVIEWS_ENABLED ? (
        <View className="flex-row items-center gap-2.5">
          <GoldButton
            label="Condividi profilo"
            onPress={() => router.push("/(waiter)/qr")}
            className="flex-1"
          />
          <GhostButton
            label="Modifica"
            onPress={() => router.push("/(waiter)/profilo-edit")}
          />
        </View>
      ) : (
        <GoldButton
          label="Modifica profilo"
          onPress={() => router.push("/(waiter)/profilo-edit")}
        />
      )}

      {/* Le tue sedi (staff fisso/a chiamata) */}
      {employers.length > 0 ? (
        <View className="gap-3">
          <Mono>Le tue sedi</Mono>
          {groupByEmployer(employers).map((group) => (
            <EmployerGroupCard key={group[0].id} venues={group} />
          ))}
        </View>
      ) : null}

      {/* Il secondo cappello, per chi ce l'ha: una sede gli ha dato la gestione
          di una sede. Non è un'altra app e non è un altro account — è lo stesso
          profilo visto dall'altra parte del bancone. */}
      <ManagerSwitchRow />

      {/* I documenti li vede solo l'azienda a cui li carichi. */}
      <NavRow
        icon="clipboard"
        title="I tuoi documenti"
        subtitle="HACCP, contratti, attestati · privati"
        onPress={() => router.push("/(waiter)/documenti")}
      />
      <NavRow
        icon="calendar"
        title="Ferie, permessi e malattia"
        subtitle="Chiedi un'assenza o comunicala al titolare"
        onPress={() => router.push("/(waiter)/assenze")}
      />

      {/* Il lavoro fatto nel periodo, fra tutte le aziende. Il periodo sta sopra
          i numeri che qualifica, come nella home del titolare. */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Mono className="flex-1">{periodLabel(period)}</Mono>
          <View className="flex-row gap-1.5">
            {STATS_PERIODS.map((p) => (
              <Chip
                key={p.value}
                label={p.label}
                gold
                active={period === p.value}
                onPress={() => setPeriod(p.value)}
              />
            ))}
          </View>
        </View>
        <View className="flex-row gap-2.5">
          <StatCard
            loading={work.isLoading}
            value={String(work.count)}
            label="Turni svolti"
          />
          <StatCard
            loading={work.isLoading}
            value={formatHours(work.totalHours)}
            label="Ore lavorate"
          />
        </View>
        <GhostButton
          label="Vedi storico turni"
          onPress={() => router.push("/(waiter)/storico")}
        />
      </View>
    </ScrollView>
  );
}
