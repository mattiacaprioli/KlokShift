import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { passwordRules } from "./schema";
import { useColors } from "@/lib/theme";

/**
 * Checklist live dei requisiti password: mostra le regole in fase di
 * registrazione e le spunta man mano che l'utente digita. Guidata da
 * `passwordRules` (stessa fonte del validatore Zod di signupSchema).
 */
export function PasswordChecklist({ value }: { value: string }) {
  const colors = useColors();
  return (
    <View className="gap-1.5">
      {passwordRules.map((rule) => {
        const ok = rule.test(value);
        return (
          <View key={rule.label} className="flex-row items-center gap-2">
            {ok ? (
              <Icon name="check" size={14} color={colors.success} />
            ) : (
              <View className="h-3.5 w-3.5 rounded-full border border-border-2" />
            )}
            <Text
              className={cn(
                "font-sans text-xs",
                ok ? "text-success" : "text-t3"
              )}
            >
              {rule.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
