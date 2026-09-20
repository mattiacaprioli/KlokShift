import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { AvatarPickerField } from "@/components/ui/AvatarPickerField";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ControlledMultiChips } from "@/components/form/ControlledMultiChips";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useAvatarUpload } from "@/features/account/useAvatarUpload";
import {
  useMyWaiterProfile,
  useSaveWaiterProfile,
} from "@/features/waiterProfile/hooks";
import { LANGUAGE_OPTIONS, PRIMARY_ROLE_EXAMPLES } from "@/features/waiterProfile/api";
import { ControlledBirthday } from "@/features/waiterProfile/BirthdayField";
import {
  waiterProfileSchema,
  type WaiterProfileForm,
} from "@/features/waiterProfile/schema";

const BIO_MAX = 180;

export default function WaiterProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, refreshProfile } = useAuth();
  const userId = session!.user.id;
  // Stesso gesto del gestore, stesso ordine delle operazioni: vedi il commento
  // in `useAvatarUpload`.
  const photo = useAvatarUpload(userId);

  const profileQuery = useMyWaiterProfile(userId);
  const save = useSaveWaiterProfile(userId);

  const { control, handleSubmit, reset } = useForm<WaiterProfileForm>({
    resolver: zodResolver(waiterProfileSchema),
    defaultValues: {
      full_name: "",
      city: "",
      bio: "",
      primary_role: "",
      languages: [],
      specializations: "",
      experience: "",
      birthday: null,
    },
  });

  // ⚠️ `defaultValue`: `useWatch` si iscrive in un effect, quindi con il
  // profilo già in cache il `reset()` qui sotto parte **prima** e la sua
  // notifica va persa — nome e contatore bio resterebbero vuoti fino al primo
  // tocco sul campo.
  const watchedName = useWatch({
    control,
    name: "full_name",
    defaultValue: profileQuery.data?.full_name ?? "",
  });
  const bioLen = (
    useWatch({
      control,
      name: "bio",
      defaultValue: profileQuery.data?.bio ?? "",
    }) ?? ""
  ).length;

  const data = profileQuery.data;
  useEffect(() => {
    if (!data) return;
    const wp = data.waiter_profile;
    reset({
      full_name: data.full_name ?? "",
      city: data.city ?? "",
      bio: data.bio ?? "",
      primary_role: wp?.primary_role ?? "",
      languages: wp?.languages ?? [],
      specializations: wp?.specializations ?? "",
      experience: wp?.experience ?? "",
      // O tutti e due o niente: è il CHECK `profiles_birthday_valid` letto dal
      // lato client, e una riga a metà qui diventerebbe un salvataggio rifiutato.
      birthday:
        data.birth_day && data.birth_month
          ? { day: data.birth_day, month: data.birth_month }
          : null,
    });
  }, [data, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        full_name: values.full_name,
        city: values.city || null,
        bio: values.bio || null,
        primary_role: values.primary_role || null,
        languages: values.languages,
        specializations: values.specializations || null,
        experience: values.experience || null,
        birthday: values.birthday,
      });
      await refreshProfile();
      toast.show("Profilo salvato");
      router.back();
    } catch {
      toast.show("Impossibile salvare. Riprova.", "error");
    }
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-3">
          <ScreenHeader
            icon="close"
            eyebrow="Profilo"
            title="Modifica profilo"
            titleClassName="text-2xl"
            right={
              <GoldButton
                size="sm"
                label="Salva"
                onPress={onSubmit}
                disabled={save.isPending || profileQuery.isLoading}
              />
            }
          />
        </View>

        {profileQuery.isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#EAB54C" />
          </View>
        ) : profileQuery.isError ? (
          <View className="flex-1 justify-center px-6">
            <QueryError onRetry={() => profileQuery.refetch()} />
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              paddingTop: 8,
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 24,
              gap: 20,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <AvatarPickerField
              uri={photo.uri}
              name={watchedName || "Professionista"}
              busy={photo.busy}
              onPick={photo.pick}
              onRemove={photo.remove}
            />

            <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
              <ControlledInput
                control={control}
                name="full_name"
                label="Nome e cognome"
                placeholder="Marco Rossi"
              />
              <ControlledInput
                control={control}
                name="primary_role"
                label="Ruolo principale"
                placeholder={PRIMARY_ROLE_EXAMPLES}
              />
              <ControlledInput
                control={control}
                name="city"
                label="Città"
                placeholder="Milano"
              />
              <ControlledBirthday control={control} name="birthday" />
            </View>

            <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
              <View>
                <ControlledInput
                  control={control}
                  name="bio"
                  label="Bio · come ti presenti"
                  placeholder="Raccontati a chi cerca personale…"
                  multiline
                  numberOfLines={4}
                  maxLength={BIO_MAX}
                  className="h-28"
                  textAlignVertical="top"
                />
                <Text className="mt-1 self-end text-xs text-t3">
                  {bioLen}/{BIO_MAX}
                </Text>
              </View>
              <ControlledMultiChips
                control={control}
                name="languages"
                label="Lingue parlate"
                options={LANGUAGE_OPTIONS}
              />
              <ControlledInput
                control={control}
                name="specializations"
                label="Specializzazioni"
                placeholder="Vini naturali, Cocktail classici"
              />
              <ControlledInput
                control={control}
                name="experience"
                label="Esperienza"
                placeholder="6 anni · Sala alta cucina"
              />
            </View>

            <View className="flex-row gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
              <Icon name="shield" size={20} color="#4FC97D" />
              <Text className="flex-1 text-sm leading-5 text-t3">
                Le recensioni le scrivono i clienti e non si modificano: è ciò
                che rende la tua reputazione affidabile.
              </Text>
            </View>

            <GoldButton
              label={save.isPending ? "Salvataggio…" : "Salva modifiche"}
              disabled={save.isPending}
              onPress={onSubmit}
            />
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
