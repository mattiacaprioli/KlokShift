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
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useRemoveStaffMember,
  useStaffMember,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import { StaffHoursSection } from "@/features/assignments/StaffHoursSection";
import { StaffPerformanceSection } from "@/features/assignments/StaffPerformanceSection";
import { ProLockedCard } from "@/features/plan/ProLock";
import { useIsPro } from "@/features/plan/hooks";
import { DocumentsSection } from "@/features/documents/DocumentsSection";
import { RoleMultiSelect } from "@/features/roles/RoleMultiSelect";
import {
  useSetStaffMemberRoles,
  useStaffMemberRoles,
} from "@/features/roles/hooks";
import type { StaffMember } from "@/features/staff/api";
import type { Enums } from "@/types/database";

/** Editable form — state seeded from props (mounted with key={member.id}). */
function StaffEditForm({
  member,
  initialRoleIds,
}: {
  member: StaffMember;
  initialRoleIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const managerId = session!.user.id;
  const isPro = useIsPro();
  const updatePerson = useUpdateStaffPerson();
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const remove = useRemoveStaffMember();
  const startConversation = useStartConversation();
  const busy =
    updatePerson.isPending ||
    update.isPending ||
    setRoles.isPending ||
    remove.isPending;

  const [name, setName] = useState(member.display_name);
  const [roleIds, setRoleIds] = useState<string[]>(initialRoleIds);
  const [empType, setEmpType] = useState<Enums<"employment_type">>(
    member.employment_type
  );
  const [phone, setPhone] = useState(member.phone ?? "");
  const [note, setNote] = useState(member.note ?? "");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const waiterId = member.waiter_id;

  /**
   * Un gesto, tre scritture, tre livelli diversi:
   *
   *   · nome/telefono/note → la **persona**, quindi valgono in tutte le sedi in
   *     cui lavora (`staff_people`);
   *   · tipo di impiego    → questa **sede** (`staff_members`): si può essere
   *     fissi a Roma e a chiamata a Milano;
   *   · ruoli              → questa sede, tabella a parte.
   *
   * In quest'ordine di proposito: se una cade, quelle già passate sono salvate e
   * il messaggio dice **quale** pezzo è rimasto indietro, invece di un generico
   * "salvataggio non riuscito" dopo il quale non si sa cosa riaprire.
   */
  async function onSave() {
    if (!name.trim()) return;
    try {
      await updatePerson.mutateAsync({
        id: member.person_id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          note: note.trim() || null,
        },
      });
    } catch {
      toast.show("Impossibile salvare. Riprova.", "error");
      return;
    }

    try {
      await update.mutateAsync({
        id: member.id,
        fields: { employment_type: empType },
      });
    } catch {
      toast.show("Tipo di impiego non salvato. Riprova.", "error");
      return;
    }

    try {
      await setRoles.mutateAsync({ staffMemberId: member.id, roleIds });
    } catch {
      toast.show("Ruoli non salvati. Riprova.", "error");
      return;
    }

    toast.show("Scheda aggiornata");
    router.back();
  }

  function onMessage() {
    if (!waiterId) return;
    startConversation.mutate(
      { waiterId, managerId },
      {
        onSuccess: (conv) => router.push(`/(manager)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  function doRemove() {
    remove.mutate(member.id, {
      onSuccess: () => {
        setConfirmVisible(false);
        toast.show("Rimosso dallo staff");
        router.back();
      },
      onError: () => {
        setConfirmVisible(false);
        toast.show("Impossibile rimuovere. Riprova.", "error");
      },
    });
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
        <ScreenHeader eyebrow="Staff" title={member.display_name} />

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
              {startConversation.isPending ? "Apertura chat…" : "Invia messaggio"}
            </Text>
          </Pressable>
        ) : null}

        {isPro ? (
          <>
            <StaffHoursSection staffMemberId={member.id} />

            <StaffPerformanceSection
              staffMemberId={member.id}
              waiterId={member.waiter_id}
            />
          </>
        ) : (
          <ProLockedCard
            title="Ore e performance"
            subtitle="Ore lavorate, affidabilità e statistiche di questo membro."
          />
        )}

        <DocumentsSection
          personId={member.person_id}
          onAdd={() =>
            router.push({
              pathname: "/(manager)/staff/documento/new",
              params: { personId: member.person_id },
            })
          }
        />

        <Input
          label="Nome"
          value={name}
          onChangeText={setName}
          placeholder="Es. Marco Rossi"
        />

        <RoleMultiSelect
          venueId={member.venue_id}
          value={roleIds}
          onChange={setRoleIds}
        />

        <View className="gap-2">
          <Mono>Tipo</Mono>
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
          className="mt-1"
          label={update.isPending ? "Salvataggio…" : "Salva"}
          disabled={busy || !name.trim()}
          onPress={onSave}
        />
        <Pressable
          disabled={busy}
          onPress={() => setConfirmVisible(true)}
          className="items-center rounded-2xl border border-border-2 py-3.5"
        >
          <Text className="text-sm font-sans-semibold text-error">
            Rimuovi dallo staff
          </Text>
        </Pressable>
      </ScrollView>

      <ConfirmModal
        visible={confirmVisible}
        title="Rimuovere dallo staff?"
        message={`${member.display_name} non sarà più nel tuo organico. Perderai anche lo storico di ore e presenze dei suoi turni (incluso l'export per il commercialista) e i documenti caricati sulla sua scheda.`}
        confirmLabel="Rimuovi"
        destructive
        pending={remove.isPending}
        onConfirm={doRemove}
        onCancel={() => setConfirmVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

export default function StaffMemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberQuery = useStaffMember(id);
  const member = memberQuery.data ?? null;
  // I ruoli seedano lo stato del form, che si monta con `key` e non si
  // risincronizza in un effetto: vanno attesi qui, non dentro il form.
  const rolesQuery = useStaffMemberRoles(id);

  if (memberQuery.isLoading || rolesQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-0">
        <ActivityIndicator color="#EAB54C" />
      </View>
    );
  }

  if (memberQuery.isError) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <QueryError onRetry={() => memberQuery.refetch()} />
      </View>
    );
  }

  if (!member) {
    return (
      <View className="flex-1 bg-bg-0">
        <EmptyState
          title="Scheda non trovata"
          subtitle="Questo membro dello staff non esiste più."
        />
      </View>
    );
  }

  return (
    <StaffEditForm
      key={member.id}
      member={member}
      initialRoleIds={(rolesQuery.data ?? []).map((r) => r.id)}
    />
  );
}
