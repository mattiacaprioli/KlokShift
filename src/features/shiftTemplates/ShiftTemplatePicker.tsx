import { useState } from "react";
import { ScrollView, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Mono } from "@/components/ui/Mono";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { ShiftTemplate } from "./api";
import { useDeleteShiftTemplate, useVenueShiftTemplates } from "./hooks";

/**
 * I modelli della sede del form, da cui ripartire con un tocco. Tenendo premuto
 * se ne elimina uno.
 *
 * Senza modelli non rende niente: la strada per crearne uno è «Salva come
 * modello» in fondo al form, e una riga vuota qui sarebbe solo rumore.
 */
export function ShiftTemplatePicker({
  venueId,
  activeId,
  onApply,
}: {
  venueId: string | undefined;
  /** L'ultimo modello applicato, acceso finché non si cambia sede. */
  activeId: string | null;
  onApply: (template: ShiftTemplate) => void;
}) {
  const toast = useToast();
  const templates = useVenueShiftTemplates(venueId);
  const remove = useDeleteShiftTemplate();
  const [toDelete, setToDelete] = useState<ShiftTemplate | null>(null);
  const list = templates.data ?? [];
  if (list.length === 0) return null;

  function onDelete() {
    if (!toDelete) return;
    remove.mutate(toDelete.id, {
      onSuccess: () => {
        toast.show("Modello eliminato");
        setToDelete(null);
      },
      onError: (e) => {
        toast.show(userErrorMessage(e), "error");
        setToDelete(null);
      },
    });
  }

  return (
    <View className="gap-2">
      <Mono>Parti da un modello</Mono>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {list.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            active={t.id === activeId}
            onPress={() => onApply(t)}
            onLongPress={() => setToDelete(t)}
          />
        ))}
      </ScrollView>
      <Text className="text-xs text-t4">Tieni premuto per eliminare.</Text>

      <ConfirmModal
        visible={!!toDelete}
        title={`Eliminare «${toDelete?.name ?? ""}»?`}
        message="I turni già creati da questo modello non cambiano."
        confirmLabel="Elimina modello"
        destructive
        pending={remove.isPending}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </View>
  );
}
