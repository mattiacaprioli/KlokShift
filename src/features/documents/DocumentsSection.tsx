import { useState } from "react";
import { ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Pressable, Text, View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import { useToast } from "@/providers/Toast";
import { documentStatus, documentStatusLabel } from "./status";
import {
  useDeleteStaffDocument,
  useDocumentQuota,
  useDocumentUrl,
  useStaffDocuments,
} from "./hooks";
import { documentQuotaNotice } from "./quota";
import type { StaffDocument } from "./api";

type Props = {
  /** Il **membro** (`workspace_members.id`): i documenti valgono in tutte le sue sedi. */
  memberId: string;
  /**
   * Dove si aggiunge un documento. Assente = sola lettura: la sede e il
   * dipendente collegato hanno gli stessi diritti sulla scheda, ma sul
   * profilo pubblico di un dipendente i documenti si guardano e basta.
   */
  onAdd?: () => void;
  title?: string;
};

/**
 * I documenti di una persona del team, con le loro scadenze.
 *
 * Condivisa fra la scheda staff del gestore e il profilo del dipendente:
 * sono le stesse righe viste dalle due parti. Chi può toccarle lo decide la RLS
 * (`staff_documents`), non questo componente.
 */
export function DocumentsSection({
  memberId,
  onAdd,
  title = "Documenti",
}: Props) {
  const toast = useToast();
  const query = useStaffDocuments(memberId);
  const docs = query.data ?? [];
  const open = useDocumentUrl();
  const remove = useDeleteStaffDocument(memberId);
  const notice = documentQuotaNotice(useDocumentQuota(memberId).data);
  const [toDelete, setToDelete] = useState<StaffDocument | null>(null);

  async function onOpen(doc: StaffDocument) {
    try {
      const url = await open.mutateAsync({ storagePath: doc.storage_path });
      // Custom Tab / SFSafariViewController: mostra PDF e immagini senza far
      // uscire dall'app, cosa che `Linking.openURL` invece fa.
      await WebBrowser.openBrowserAsync(url);
    } catch {
      toast.show("Impossibile aprire il documento. Riprova.", "error");
    }
  }

  function doDelete() {
    if (!toDelete) return;
    remove.mutate(toDelete, {
      onSuccess: () => {
        setToDelete(null);
        toast.show("Documento eliminato");
      },
      onError: () => {
        setToDelete(null);
        toast.show("Impossibile eliminare. Riprova.", "error");
      },
    });
  }

  return (
    <View className="gap-3">
      {/* A quota piena il caricamento verrebbe rifiutato: niente «Aggiungi». */}
      <SectionHeader
        title={title}
        actionLabel={onAdd && notice?.level !== "full" ? "Aggiungi" : undefined}
        onAction={notice?.level !== "full" ? onAdd : undefined}
      />
      {notice ? (
        <Text className={cn("text-[13px] leading-5", notice.level === "full" ? "text-error" : "text-gold")}>
          {notice.text}
        </Text>
      ) : null}

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : docs.length === 0 ? (
        <Text className="text-[13px] leading-5 text-t3">
          {onAdd
            ? "Nessun documento. Carica HACCP, contratti o attestati: qui restano insieme alle loro scadenze."
            : "Nessun documento caricato."}
        </Text>
      ) : (
        <View className="gap-2">
          {docs.map((doc) => {
            const status = documentStatus(doc.expires_at);
            return (
              <View
                key={doc.id}
                className="flex-row items-center gap-3 rounded-2xl border border-border-2 bg-bg-card p-4"
              >
                <Pressable
                  className="flex-1 flex-row items-center gap-3"
                  onPress={() => onOpen(doc)}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl border border-border-2 bg-bg-1">
                    <Icon name="clipboard" size={18} color="#EAB54C" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-sans-semibold text-t1">
                      {doc.name}
                    </Text>
                    <Text
                      className={cn(
                        "mt-0.5 text-xs",
                        status === "expired" ? "text-error" : "text-t3"
                      )}
                    >
                      {documentStatusLabel(doc.expires_at)}
                    </Text>
                  </View>
                </Pressable>

                {status === "expired" ? (
                  <Pill label="Scaduto" variant="cancelled" />
                ) : status === "expiring" ? (
                  <Pill label="In scadenza" variant="pending" />
                ) : null}

                {onAdd ? (
                  <Pressable
                    onPress={() => setToDelete(doc)}
                    hitSlop={8}
                    className="p-1"
                  >
                    <Icon name="close" size={18} color="#8c857a" />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      <ConfirmModal
        visible={!!toDelete}
        title="Eliminare il documento?"
        message={`«${toDelete?.name}» verrà rimosso dalla scheda, insieme al file caricato.`}
        confirmLabel="Elimina"
        destructive
        pending={remove.isPending}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </View>
  );
}
