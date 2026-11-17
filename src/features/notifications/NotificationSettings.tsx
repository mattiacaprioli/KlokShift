import { useState } from "react";
import { Switch } from "react-native";
import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import {
  NOTIFICATION_CATEGORIES,
  prefsFromProfile,
  saveNotificationPrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from "./preferences";
import { useColors } from "@/lib/theme";

/**
 * Sezione "Notifiche push" delle Impostazioni: uno switch per categoria
 * (Messaggi / Turni / Staff). Filtra SOLO la push OS — la notifica
 * in-app resta visibile nella campanella. Condivisa tra cameriere e ristoratore.
 */
export function NotificationSettings() {
  const colors = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const userId = session!.user.id;

  const [prefs, setPrefs] = useState<NotificationPrefs>(() =>
    prefsFromProfile(profile?.notification_prefs)
  );
  const [saving, setSaving] = useState(false);

  async function toggle(id: NotificationCategory, value: boolean) {
    const prev = prefs;
    const next = { ...prefs, [id]: value };
    setPrefs(next); // ottimistico
    setSaving(true);
    try {
      await saveNotificationPrefs(userId, next);
      await refreshProfile();
    } catch {
      setPrefs(prev); // rollback
      toast.show("Non è stato possibile salvare. Riprova.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-2">
      <SectionHeader title="Notifiche push" />
      <Card className="p-0">
        {NOTIFICATION_CATEGORIES.map((c, i) => (
          <View
            key={c.id}
            className={cn(
              "flex-row items-center justify-between gap-3 px-4 py-3.5",
              i > 0 && "border-t border-border"
            )}
          >
            <View className="flex-1">
              <Text className="text-[15px] font-sans-semibold text-t1">
                {c.label}
              </Text>
              <Text className="mt-0.5 text-[13px] text-t3">{c.description}</Text>
            </View>
            <Switch
              value={prefs[c.id] ?? true}
              onValueChange={(v) => toggle(c.id, v)}
              disabled={saving}
              trackColor={{ false: colors.bg2, true: colors.goldFill }}
              thumbColor={colors.t1}
              ios_backgroundColor={colors.bg2}
            />
          </View>
        ))}
      </Card>
      <Text className="px-1 text-[12px] text-t4">
        Le notifiche restano visibili nell&apos;app; questi interruttori
        controllano solo gli avvisi push sul dispositivo.
      </Text>
    </View>
  );
}
