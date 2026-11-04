import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { operationsGate } from "@/features/workspace/access";
import { useExportCodes, useSaveExportCodes } from "@/features/assignments/hooks";
import {
  EXPORT_CODE_KEYS,
  EXPORT_CODE_LABELS,
  type ExportCodeKey,
  type ExportCodes,
} from "@/features/assignments/exportCodes";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";

/**
 * I codici del programma paghe del consulente: il codice dell'azienda e uno per
 * causale. Finiscono nei CSV della pagina Ore; vuoti = colonna vuota, l'export
 * parte lo stesso. Li scrive chi ha «Ore» (`save_export_codes`).
 */
export default function ExportCodesScreen() {
  const insets = useSafeAreaInsets();
  const { workspaceId } = useOwnerVenues();
  const query = useExportCodes(workspaceId);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-2">
          <ScreenHeader eyebrow="Ore" title="Codici per il consulente" />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 24,
            gap: 16,
          }}
        >
          <Text className="text-sm leading-5 text-t2">
            Te li dà il tuo consulente: sono i codici del suo programma paghe. Puoi
            lasciarli vuoti.
          </Text>
          {!workspaceId || query.isError ? (
            <QueryError onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <ListSkeleton />
          ) : (
            <CodesForm workspaceId={workspaceId} initial={query.data} />
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function CodesForm({ workspaceId, initial }: { workspaceId: string; initial: ExportCodes }) {
  const router = useRouter();
  const toast = useToast();
  const save = useSaveExportCodes(workspaceId);
  // In archivio i codici si leggono ma non si cambiano: lo si dice, invece di
  // lasciar fallire «Salva».
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const [values, setValues] = useState<Record<ExportCodeKey, string>>(() => {
    const out = {} as Record<ExportCodeKey, string>;
    for (const k of EXPORT_CODE_KEYS) out[k] = initial.codes[k] ?? "";
    return out;
  });

  async function onSave() {
    try {
      await save.mutateAsync(values);
      toast.show("Codici salvati");
      router.back();
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <View className="gap-4">
      {EXPORT_CODE_KEYS.map((k) => (
        <Input
          key={k}
          label={EXPORT_CODE_LABELS[k]}
          value={values[k]}
          onChangeText={(v) => setValues((prev) => ({ ...prev, [k]: v }))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          editable={gate.allowed}
        />
      ))}
      {gate.allowed ? (
        <GoldButton label="Salva" onPress={() => void onSave()} disabled={save.isPending} />
      ) : (
        <Text className="text-sm leading-5 text-t3">{gate.reason}</Text>
      )}
    </View>
  );
}
