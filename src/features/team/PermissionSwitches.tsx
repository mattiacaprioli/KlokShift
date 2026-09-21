import { Switch } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import {
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  type TeamPermission,
  type TeamPermissions,
} from "./api";

/**
 * Le cinque aree di permesso, una riga per area.
 *
 * Interruttori e non ruoli preconfezionati ("gestore", "sola lettura") perché il
 * titolare sa già come si divide il lavoro nella sua sede: chi fa solo i turni,
 * chi tiene i documenti, chi guarda le ore a fine mese. Un preset avrebbe
 * costretto a scegliere il più largo dei due che servivano.
 *
 * ⚠️ Nessun import di Expo Router: la dashboard web riusa questo componente.
 */
export function PermissionSwitches({
  value,
  onChange,
  disabled,
}: {
  value: TeamPermissions;
  onChange: (perm: TeamPermission, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Card className="gap-0 p-0">
      {TEAM_PERMISSIONS.map((perm, i) => (
        <View
          key={perm}
          className={
            i === 0
              ? "flex-row items-center gap-3 px-4 py-3.5"
              : "flex-row items-center gap-3 border-t border-border-1 px-4 py-3.5"
          }
        >
          <View className="flex-1">
            <Text className="text-[15px] font-sans-semibold text-t1">
              {TEAM_PERMISSION_LABEL[perm]}
            </Text>
            <Text className="mt-0.5 text-[13px] leading-4 text-t3">
              {TEAM_PERMISSION_HINT[perm]}
            </Text>
          </View>
          <Switch
            value={value[perm]}
            onValueChange={(next) => onChange(perm, next)}
            disabled={disabled}
            trackColor={{ false: "#2a241b", true: "#eab54c" }}
            thumbColor="#f8f4ed"
            ios_backgroundColor="#2a241b"
          />
        </View>
      ))}
    </Card>
  );
}
