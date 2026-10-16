import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { formatShiftRange } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import type { ShiftTemplate } from "./api";
import { useDeleteShiftTemplate, useVenueShiftTemplates } from "./hooks";

/**
 * «Modelli» in alto a destra nel form del nuovo turno: il tocco apre un pannello
 * dal basso con i modelli della sede del form, e sceglierne uno riempie il form.
 *
 * L'eliminazione chiede conferma **dentro** il pannello, sulla riga stessa: un
 * secondo `Modal` sopra al primo su iOS a volte non si presenta, e chiudere il
 * pannello per aprirne un altro farebbe perdere il segno.
 */
export function ShiftTemplatesButton({
  venueId,
  activeId,
  onApply,
}: {
  venueId: string | undefined;
  /** L'ultimo modello applicato, segnato nell'elenco. */
  activeId: string | null;
  onApply: (template: ShiftTemplate) => void;
}) {
  const toast = useToast();
  const templates = useVenueShiftTemplates(venueId);
  const remove = useDeleteShiftTemplate();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const list = templates.data ?? [];

  function close() {
    setOpen(false);
    setConfirming(null);
  }

  function onDelete(t: ShiftTemplate) {
    remove.mutate(t.id, {
      onSuccess: () => {
        toast.show("Modello eliminato");
        setConfirming(null);
      },
      onError: (e) => {
        toast.show(userErrorMessage(e), "error");
        setConfirming(null);
      },
    });
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!venueId}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Modelli di turno"
        className={cn(
          "h-10 flex-row items-center gap-1 rounded-full border border-border-2 bg-bg-2 pl-3.5 pr-2.5",
          !venueId && "opacity-50"
        )}
      >
        <Text className="text-sm font-sans-semibold text-t1">Modelli</Text>
        <Icon
          name="chevR"
          size={16}
          color="#8c857a"
          style={{ transform: [{ rotate: "90deg" }] }}
        />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={close}
        dismissable={!remove.isPending}
      >
        <Text className="text-lg font-sans-bold text-t1">
          Parti da un modello
        </Text>
        <Text className="mt-1.5 text-sm leading-5 text-t2">
          Riempie orari, pausa, fabbisogno e note. Giorno e persone restano
          quelli che hai scelto.
        </Text>

        <View className="pt-6">
          {list.length === 0 ? (
            <Text className="text-sm leading-5 text-t3">
              {templates.isPending
                ? "Caricamento…"
                : "Nessun modello per questa sede. Compila il turno e usa «Salva come modello» in fondo al form."}
            </Text>
          ) : (
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerClassName="gap-2"
              showsVerticalScrollIndicator={false}
            >
              {list.map((t) =>
                confirming === t.id ? (
                  <View
                    key={t.id}
                    className="gap-3 rounded-2xl border border-error/40 bg-error/10 px-4 py-3.5"
                  >
                    <Text className="text-sm leading-5 text-t1">
                      Eliminare «{t.name}»? I turni già creati non cambiano.
                    </Text>
                    <View className="flex-row gap-2.5">
                      <Pressable
                        onPress={() => onDelete(t)}
                        disabled={remove.isPending}
                        className="flex-1 items-center rounded-xl bg-error py-2.5"
                      >
                        <Text className="text-sm font-sans-semibold text-white">
                          {remove.isPending ? "Elimino…" : "Elimina"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setConfirming(null)}
                        disabled={remove.isPending}
                        className="flex-1 items-center rounded-xl border border-border py-2.5"
                      >
                        <Text className="text-sm font-sans-semibold text-t2">
                          Annulla
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      onApply(t);
                      close();
                    }}
                    className={cn(
                      "flex-row items-center gap-3 rounded-2xl border px-4 py-3.5",
                      t.id === activeId
                        ? "border-gold bg-gold/10"
                        : "border-border bg-bg-2"
                    )}
                  >
                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className={cn(
                          "text-base font-sans-semibold",
                          t.id === activeId ? "text-gold" : "text-t1"
                        )}
                      >
                        {t.name}
                      </Text>
                      <Text className="mt-0.5 font-mono text-xs text-t3">
                        {formatShiftRange(t.start_time, t.end_time)}
                      </Text>
                    </View>
                    {t.id === activeId ? (
                      <Icon name="check" size={18} color="#EAB54C" />
                    ) : null}
                    <Pressable
                      onPress={() => setConfirming(t.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Elimina il modello ${t.name}`}
                      className="h-8 w-8 items-center justify-center rounded-full"
                    >
                      <Icon name="close" size={16} color="#6A6358" />
                    </Pressable>
                  </Pressable>
                )
              )}
            </ScrollView>
          )}
        </View>
      </BottomSheet>
    </>
  );
}
