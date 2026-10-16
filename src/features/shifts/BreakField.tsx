import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { SelectChip } from "@/components/ui/SelectChip";
import { formatBreakMinutes } from "@/lib/format";
import { View } from "@/tw";
import { BREAK_PRESETS, MAX_BREAK_MINUTES } from "./breaks";

type Props = {
  minutes: number;
  onChange: (minutes: number) => void;
};

/**
 * La pausa pianificata del turno: le durate comuni a un tocco, «Altro» per i
 * minuti liberi. Se sia retribuita lo decide la sede, non questo campo.
 */
export function BreakField({ minutes, onChange }: Props) {
  const preset = (BREAK_PRESETS as readonly number[]).includes(minutes);
  const [custom, setCustom] = useState(!preset);
  const [draft, setDraft] = useState(preset ? "" : String(minutes));

  return (
    <View className="gap-2">
      <Mono>Pausa</Mono>
      <View className="flex-row flex-wrap gap-2">
        {BREAK_PRESETS.map((value) => (
          <SelectChip
            key={value}
            label={value === 0 ? "Nessuna" : formatBreakMinutes(value)}
            active={!custom && minutes === value}
            onPress={() => {
              setCustom(false);
              onChange(value);
            }}
          />
        ))}
        <SelectChip
          label="Altro"
          active={custom}
          onPress={() => {
            setCustom(true);
            setDraft(minutes > 0 ? String(minutes) : "");
          }}
        />
      </View>
      {custom ? (
        <Input
          value={draft}
          onChangeText={(text) => {
            const digits = text.replace(/\D/g, "").slice(0, 3);
            setDraft(digits);
            onChange(Math.min(MAX_BREAK_MINUTES, Number(digits || 0)));
          }}
          keyboardType="number-pad"
          placeholder="Minuti di pausa"
          accessibilityLabel="Minuti di pausa"
        />
      ) : null}
    </View>
  );
}
