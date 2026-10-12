import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import {
  changePasswordSchema,
  isPasswordValid,
  type ChangePasswordForm as ChangePasswordValues,
} from "./schema";
import { PasswordChecklist } from "./PasswordChecklist";

/**
 * Cambio password da loggati, condiviso dalle impostazioni dei due lati.
 *
 * Il gemello web è `PasswordSection` in `web/src/pages/Impostazioni.tsx`; il
 * recupero da password dimenticata è un'altra strada e passa solo dalla
 * dashboard (`NuovaPassword.tsx`).
 *
 * Se la password cambia ma gli altri dispositivi non si disconnettono, il form
 * resta aperto con un avviso (non un errore) finché non lo si chiude: chi cambia
 * password per un sospetto deve saperlo, e un toast sparirebbe da solo.
 */
export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { changePassword } = useAuth();
  const [apiError, setApiError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm<ChangePasswordValues>({
    // Come in registrazione: la checklist invita a guardare i requisiti, e un
    // errore che compare solo all'invio non dice niente prima.
    mode: "onTouched",
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });
  const current = useWatch({ control, name: "currentPassword" }) ?? "";
  const password = useWatch({ control, name: "password" }) ?? "";
  const confirmPassword = useWatch({ control, name: "confirmPassword" }) ?? "";
  const ready =
    current.length > 0 &&
    isPasswordValid(password) &&
    password === confirmPassword;

  const onSubmit = handleSubmit(async (values) => {
    if (loading) return;
    setApiError(null);
    setLoading(true);
    const res = await changePassword(values.currentPassword, values.password);
    setLoading(false);
    if (res.error) {
      setApiError(res.error);
      return;
    }
    if (res.warning) {
      setWarning(res.warning);
      return;
    }
    onDone();
  });

  if (warning) {
    return (
      <View className="gap-4">
        <Text className="font-sans-bold text-base text-t1">
          Password aggiornata.
        </Text>
        <Text className="font-sans text-sm leading-5 text-t2">{warning}</Text>
        <GoldButton className="mt-2" size="lg" label="Fatto" onPress={onDone} />
      </View>
    );
  }

  return (
    <View className="gap-4">
      <ControlledInput
        control={control}
        name="currentPassword"
        label="Password attuale"
        placeholder="Quella con cui accedi oggi"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
      />
      <ControlledInput
        control={control}
        name="password"
        label="Nuova password"
        placeholder="Crea una password sicura"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
      />
      <ControlledInput
        control={control}
        name="confirmPassword"
        label="Ripeti la nuova password"
        placeholder="La stessa password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
      />
      <PasswordChecklist value={password} />

      <Text className="font-sans text-[13px] leading-5 text-t3">
        Gli altri dispositivi dove hai fatto l&apos;accesso verranno
        disconnessi.
      </Text>

      {apiError ? (
        <Text className="font-sans text-sm text-error">{apiError}</Text>
      ) : null}

      <GoldButton
        className="mt-2"
        size="lg"
        label={loading ? "Salvataggio…" : "Cambia password"}
        disabled={loading || !ready}
        onPress={onSubmit}
      />
    </View>
  );
}
