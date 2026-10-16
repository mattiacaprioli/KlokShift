import { Switch } from "react-native";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Segmented } from "@/components/ui/Segmented";
import { SelectChip } from "@/components/ui/SelectChip";
import {
  BREAK_POLICY_COPY,
  BREAK_RULE_MINUTES,
  BREAK_RULE_THRESHOLDS,
  DEFAULT_BREAK_RULE,
} from "@/features/shifts/breaks";
import type { Venue } from "@/features/venues/api";
import { userErrorMessage } from "@/lib/errors";
import { formatBreakMinutes } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { Text, View } from "@/tw";
import { useSetVenueBreakPolicy } from "./hooks";

type Policy = {
  paid: boolean;
  ruleAfterMinutes: number | null;
  ruleMinutes: number | null;
};

/**
 * Pausa retribuita o no, e la regola che la propone nei turni lunghi: per chi
 * ha il permesso Ore, come il metodo di timbratura. Ogni tocco salva.
 */
export function VenueBreakCard({ venue }: { venue: Venue }) {
  const toast = useToast();
  const save = useSetVenueBreakPolicy();
  const current: Policy = {
    paid: venue.break_paid,
    ruleAfterMinutes: venue.break_rule_after_minutes,
    ruleMinutes: venue.break_rule_minutes,
  };
  const ruleOn = current.ruleAfterMinutes != null;

  function update(next: Partial<Policy>) {
    save.mutate(
      { venueId: venue.id, ...current, ...next },
      {
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile salvare. Riprova."), "error"),
      }
    );
  }

  return (
    <View className="gap-2">
      <SectionHeader className="mb-0" title={`Pausa · ${venue.name}`} />
      <Card className="gap-3 px-4 py-3.5">
        <Segmented
          options={[
            { id: "unpaid", label: "Non retribuita" },
            { id: "paid", label: "Retribuita" },
          ]}
          value={current.paid ? "paid" : "unpaid"}
          onChange={(id) => {
            if ((id === "paid") !== current.paid) update({ paid: id === "paid" });
          }}
        />
        <Text className="text-[13px] leading-5 text-t3">
          {current.paid ? BREAK_POLICY_COPY.paid : BREAK_POLICY_COPY.unpaid}
        </Text>
      </Card>
      <Card className="gap-3 px-4 py-3.5">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-[15px] font-sans-semibold text-t1">
              Proponi una pausa nei turni lunghi
            </Text>
            <Text className="mt-0.5 text-[13px] leading-5 text-t3">
              {BREAK_POLICY_COPY.rule}
            </Text>
          </View>
          <Switch
            value={ruleOn}
            onValueChange={(on) =>
              update(
                on
                  ? {
                      ruleAfterMinutes: DEFAULT_BREAK_RULE.afterMinutes,
                      ruleMinutes: DEFAULT_BREAK_RULE.minutes,
                    }
                  : { ruleAfterMinutes: null, ruleMinutes: null }
              )
            }
            disabled={save.isPending}
            accessibilityLabel={`Proponi una pausa nei turni lunghi per ${venue.name}`}
            trackColor={{ false: "#2a241b", true: "#eab54c" }}
            thumbColor="#f8f4ed"
            ios_backgroundColor="#2a241b"
          />
        </View>
        {ruleOn ? (
          <>
            <Text className="text-[13px] text-t3">Nei turni oltre</Text>
            <View className="flex-row flex-wrap gap-2">
              {BREAK_RULE_THRESHOLDS.map((minutes) => (
                <SelectChip
                  key={minutes}
                  label={`${minutes / 60} h`}
                  active={current.ruleAfterMinutes === minutes}
                  onPress={() => update({ ruleAfterMinutes: minutes })}
                />
              ))}
            </View>
            <Text className="text-[13px] text-t3">una pausa di</Text>
            <View className="flex-row flex-wrap gap-2">
              {BREAK_RULE_MINUTES.map((minutes) => (
                <SelectChip
                  key={minutes}
                  label={formatBreakMinutes(minutes)}
                  active={current.ruleMinutes === minutes}
                  onPress={() => update({ ruleMinutes: minutes })}
                />
              ))}
            </View>
          </>
        ) : null}
      </Card>
      <Text className="px-1 text-[12px] leading-5 text-t4">
        {BREAK_POLICY_COPY.note}
      </Text>
    </View>
  );
}
