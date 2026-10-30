import { useState } from "react";
import { KeyboardAvoidingView, Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useSaveShiftTemplate, useVenueShiftTemplates } from "./hooks";
import {
  MAX_TEMPLATE_NAME,
  findTemplateByName,
  type ShiftTemplateInput,
} from "./template";

/**
 * Dà un nome al modello e lo salva. Si monta solo quando serve (il chiamante
 * tiene il payload in uno stato e lo rende condizionalmente), così il nome
 * riparte ogni volta da quello proposto.
 *
 * Un nome che la sede ha già aggiorna quel modello: lo si dice prima, non dopo.
 */
export function SaveTemplateModal({
  venueId,
  template,
  onSaved,
  onClose,
}: {
  venueId: string;
  /** Il turno da ricordare; `name` è il nome proposto. */
  template: ShiftTemplateInput;
  /** Il modello salvato, per chi vuole restarci agganciato (il form). */
  onSaved?: (saved: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const templates = useVenueShiftTemplates(venueId);
  const save = useSaveShiftTemplate();
  const existing = findTemplateByName(templates.data ?? [], name);
  const canSave = name.trim().length > 0 && !save.isPending;

  function onSave() {
    const trimmed = name.trim();
    save.mutate(
      { venueId, input: { ...template, name: trimmed } },
      {
        onSuccess: (id) => {
          toast.show(existing ? "Modello aggiornato" : "Modello salvato");
          onSaved?.({ id, name: trimmed });
          onClose();
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Modello non salvato. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={save.isPending ? undefined : onClose}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable
          onPress={save.isPending ? undefined : onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
          className="items-center justify-center px-6"
        >
          <Pressable
            onPress={() => {}}
            className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
          >
            <Text className="text-lg font-sans-bold text-t1">
              Salva come modello
            </Text>
            <Text className="mt-2 text-sm leading-5 text-t2">
              Ricorda orari, pausa, persone che servono e note. Giorno e persone li
              scegli ogni volta.
            </Text>

            <View className="mt-5 gap-2">
              <Input
                label="Nome del modello"
                value={name}
                onChangeText={setName}
                placeholder="Es. Cena"
                maxLength={MAX_TEMPLATE_NAME}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={canSave ? onSave : undefined}
              />
              {existing ? (
                <Text className="text-xs text-t3">
                  Esiste già «{existing.name}»: salvando lo aggiorni.
                </Text>
              ) : null}
            </View>

            <View className="mt-6 gap-2.5">
              <GoldButton
                label={save.isPending ? "Salvataggio…" : "Salva modello"}
                disabled={!canSave}
                onPress={onSave}
              />
              <Pressable
                onPress={onClose}
                disabled={save.isPending}
                className="items-center rounded-xl border border-border py-3.5"
              >
                <Text className="text-sm font-sans-semibold text-t2">
                  Annulla
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
