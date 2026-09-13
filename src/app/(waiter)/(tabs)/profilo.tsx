import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Display } from "@/components/ui/Display";
import { ExperienceTimeline } from "@/components/ui/ExperienceTimeline";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NavRow } from "@/components/ui/NavRow";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useExperiences } from "@/features/experiences/hooks";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { useMyWaiterProfile } from "@/features/waiterProfile/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import { useLeaveVenue, useMyEmployers } from "@/features/staff/hooks";
import { useMyWorkHistoryTotals } from "@/features/assignments/history";
import type { MyEmployer } from "@/features/staff/api";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "esperienze" | "statistiche";
const TABS: { id: Tab; label: string }[] = [
  { id: "esperienze", label: "Esperienze" },
  { id: "statistiche", label: "Statistiche" },
];

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5">
      <Mono>{label}</Mono>
      <Text className="text-sm text-t2">{value}</Text>
    </View>
  );
}

/** Un locale per cui il cameriere è staff, con azioni "Scrivi"/"Lascia". */
function EmployerCard({
  employer,
  waiterId,
}: {
  employer: MyEmployer;
  waiterId: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const leave = useLeaveVenue();
  const startConversation = useStartConversation();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const venueName = employer.venue?.name ?? "Locale";
  const ownerId = employer.venue?.owner_id ?? null;

  function onContact() {
    if (!ownerId) return;
    startConversation.mutate(
      { waiterId, managerId: ownerId },
      {
        onSuccess: (conv) => router.push(`/(waiter)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  function onConfirm() {
    leave.mutate(employer.id, {
      onSuccess: () => {
        setConfirmVisible(false);
        toast.show("Hai lasciato il locale");
      },
      onError: () => {
        setConfirmVisible(false);
        toast.show("Operazione non riuscita. Riprova.", "error");
      },
    });
  }

  return (
    <Card className="rounded-3xl border-border-2 p-4">
      <View className="flex-row items-center gap-3">
        <Avatar
          uri={employer.venue?.logo_url ?? undefined}
          name={venueName}
          size={40}
        />
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1">{venueName}</Text>
          {employer.venue?.city ? (
            <Text className="text-xs text-t3">{employer.venue.city}</Text>
          ) : null}
        </View>
        <Chip
          label={employer.employment_type === "fisso" ? "Fisso" : "A chiamata"}
          active
          gold={employer.employment_type === "fisso"}
        />
      </View>
      <View className="mt-3 flex-row items-center gap-5">
        {ownerId ? (
          <Pressable
            onPress={onContact}
            disabled={startConversation.isPending}
            hitSlop={6}
          >
            <Text className="text-sm font-sans-semibold text-gold">
              {startConversation.isPending ? "Apertura…" : "Scrivi al locale"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setConfirmVisible(true)} hitSlop={6}>
          <Text className="text-sm font-sans-semibold text-error">
            Lascia il locale
          </Text>
        </Pressable>
      </View>

      <ConfirmModal
        visible={confirmVisible}
        title={`Lasciare ${venueName}?`}
        // Il nome della sede nel titolo, non "questo locale": un datore di lavoro
        // può averne più di una, e chi si dimette da Milano deve vedere scritto
        // "Milano" prima di confermare.
        message={`Non farai più parte dello staff di ${venueName}. Se lavori in altre sedi dello stesso datore di lavoro, quelle restano — e con loro i tuoi documenti.`}
        confirmLabel="Lascia"
        destructive
        pending={leave.isPending}
        onConfirm={onConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </Card>
  );
}

export default function WaiterProfiloScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const name = profile?.full_name ?? "Cameriere";
  const userId = session!.user.id;
  const [tab, setTab] = useState<Tab>("esperienze");

  const profileQuery = useMyWaiterProfile(userId);
  const data = profileQuery.data;
  const wp = data?.waiter_profile ?? null;
  const role = wp?.primary_role ?? null;
  const city = data?.city ?? null;
  const bio = data?.bio ?? null;
  const languages = wp?.languages ?? [];
  const specializations = wp?.specializations ?? null;
  const hasProfileInfo = !!bio || languages.length > 0 || !!specializations;

  const experiences = useExperiences(userId).data ?? [];

  const employers = useMyEmployers(userId).data ?? [];
  // Solo i due totali: il Profilo non mostra la lista dei turni.
  const history = useMyWorkHistoryTotals(userId);
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
        <Mono>Profilo · Pubblico</Mono>
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

      {/* I tuoi locali (staff fisso/a chiamata) */}
      {employers.length > 0 ? (
        <View className="gap-3">
          <Mono>I tuoi locali</Mono>
          {employers.map((e) => (
            <EmployerCard key={e.id} employer={e} waiterId={userId} />
          ))}
        </View>
      ) : null}

      {/* Fuori dai tab qui sotto, che sono la parte **pubblica** del profilo:
          i documenti li vede solo il locale a cui li carichi. */}
      <NavRow
        icon="clipboard"
        title="I tuoi documenti"
        subtitle="HACCP, contratti, attestati · privati"
        onPress={() => router.push("/(waiter)/documenti")}
      />

      {/* Tabs */}
      <View className="flex-row gap-1 rounded-2xl border border-border bg-bg-card p-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              className={cn(
                "flex-1 items-center rounded-xl py-2.5",
                active && "bg-bg-2",
              )}
            >
              <Text
                className={cn(
                  "text-sm",
                  active ? "font-sans-semibold text-t1" : "text-t3",
                )}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "esperienze" ? (
        <View className="gap-6">
          <View>
            <SectionHeader
              title="Esperienze"
              actionLabel="Aggiungi"
              onAction={() => router.push("/(waiter)/esperienza/new")}
            />
            {experiences.length > 0 ? (
              <ExperienceTimeline
                items={experiences}
                onPressItem={(id) =>
                  router.push(`/(waiter)/esperienza/${id}`)
                }
              />
            ) : (
              <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
                <Text className="text-sm leading-5 text-t3">
                  Aggiungi i tuoi lavori passati per farti notare da chi
                  cerca personale.
                </Text>
                <GoldButton
                  label="Aggiungi esperienza"
                  onPress={() => router.push("/(waiter)/esperienza/new")}
                />
              </View>
            )}
          </View>

          {hasProfileInfo ? (
            <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
              <Mono>Il tuo profilo</Mono>
              {bio ? (
                <Text className="text-sm leading-5 text-t2">{bio}</Text>
              ) : null}
              {languages.length > 0 ? (
                <InfoLine label="Lingue" value={languages.join(" · ")} />
              ) : null}
              {specializations ? (
                <InfoLine label="Specializzazioni" value={specializations} />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {tab === "statistiche" ? (
        <View className="gap-3">
          <View className="flex-row gap-2.5">
            <StatCard value={String(history.count)} label="turni svolti" />
            <StatCard value={formatHours(history.totalHours)} label="ore totali" />
          </View>
          <GhostButton
            label="Vedi storico turni"
            onPress={() => router.push("/(waiter)/storico")}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
