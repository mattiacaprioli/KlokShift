import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboardAvoidingView } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { ControlledInput } from "@/components/form/ControlledInput";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { experienceSchema, type ExperienceForm } from "./schema";

type Props = {
  defaultValues: ExperienceForm;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  onSubmit: (values: ExperienceForm) => void;
  /** Se presente, mostra "Elimina esperienza" (testo rosso + ConfirmModal). */
  onDelete?: () => void;
  deletePending?: boolean;
};

/** Form condiviso per creare e modificare un'esperienza (stessi campi + validazione). */
export function ExperienceFormView({
  defaultValues,
  submitLabel,
  pendingLabel,
  pending,
  onSubmit,
  onDelete,
  deletePending,
}: Props) {
  const { control, handleSubmit } = useForm<ExperienceForm>({
    resolver: zodResolver(experienceSchema),
    defaultValues,
  });
  const present = useWatch({ control, name: "present" });
  const [confirmVisible, setConfirmVisible] = useState(false);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="p-6 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <ControlledInput
          control={control}
          name="company_name"
          label="Sede"
          placeholder="Es. Trattoria da Gino"
        />
        <ControlledInput
          control={control}
          name="role"
          label="Ruolo"
          placeholder="Es. Chef de Rang"
        />
        <ControlledInput
          control={control}
          name="start_year"
          label="Anno inizio"
          keyboardType="number-pad"
          maxLength={4}
          placeholder="2022"
        />

        <View className="flex-row items-center justify-between">
          <Mono>Lavoro attuale</Mono>
          <Controller
            control={control}
            name="present"
            render={({ field: { value, onChange } }) => (
              <Chip
                label="OGGI"
                active={value}
                gold={value}
                onPress={() => onChange(!value)}
              />
            )}
          />
        </View>

        {!present ? (
          <ControlledInput
            control={control}
            name="end_year"
            label="Anno fine"
            keyboardType="number-pad"
            maxLength={4}
            placeholder="2024"
          />
        ) : null}

        <ControlledInput
          control={control}
          name="detail"
          label="Dettaglio"
          placeholder="Es. Sala 32 coperti · cucina lombarda"
          multiline
          numberOfLines={3}
          className="h-24"
          textAlignVertical="top"
        />

        <GoldButton
          className="mt-2"
          label={pending ? pendingLabel : submitLabel}
          disabled={pending}
          onPress={handleSubmit(onSubmit)}
        />

        {onDelete ? (
          <Pressable
            disabled={pending || deletePending}
            onPress={() => setConfirmVisible(true)}
            className="items-center rounded-2xl border border-border-2 py-3.5"
          >
            <Text className="text-sm font-sans-semibold text-error">
              Elimina esperienza
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {onDelete ? (
        <ConfirmModal
          visible={confirmVisible}
          title="Eliminare l'esperienza?"
          message="Questa esperienza verrà rimossa dal tuo profilo."
          confirmLabel="Elimina"
          destructive
          pending={deletePending}
          onConfirm={onDelete}
          onCancel={() => setConfirmVisible(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
