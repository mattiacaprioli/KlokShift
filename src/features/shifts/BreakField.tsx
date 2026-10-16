import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { SelectChip } from "@/components/ui/SelectChip";
import { formatBreakMinutes } from "@/lib/format";
import { View } from "@/tw";
import { BREAK_PRESETS, MAX_BREAK_MINUTES } from "./breaks";

function isPreset(minutes: number) {
  return (BREAK_PRESETS as readonly number[]).includes(minutes);
}

type Props = {
  minutes: number;
  onChange: (minutes: number) => void;
};

/**
 * La pausa pianificata del turno: le durate comuni a un tocco, «Altro» per i
 * minuti liberi. Se sia retribuita lo decide la sede, non questo campo.
 */
export function BreakField({ minutes, onChange }: Props) {
  const preset = isPreset(minutes);
  const [custom, setCustom] = useState(!preset);
  const [draft, setDraft] = useState(preset ? "" : String(minutes));
  // L'ultimo valore scritto da questo campo, e l'ultimo ricevuto.
  const [emitted, setEmitted] = useState<number | null>(null);
  const [seen, setSeen] = useState(minutes);

  /**
   * La pausa può cambiare da fuori: un modello di turno, la regola della sede
   * quando cambia l'orario. Allora il campo la mostra com'è — 20 minuti aprono
   * «Altro», 30 accendono il chip. Quella scritta qui no: chi digita «30» in
   * «Altro» non deve vederselo chiudere a metà.
   */
  if (minutes !== seen) {
    setSeen(minutes);
    if (minutes !== emitted) {
      setCustom(!isPreset(minutes));
      setDraft(isPreset(minutes) ? "" : String(minutes));
    }
  }

  function emit(value: number) {
    setEmitted(value);
    onChange(value);
  }

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
              emit(value);
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
            emit(Math.min(MAX_BREAK_MINUTES, Number(digits || 0)));
          }}
          keyboardType="number-pad"
          placeholder="Minuti di pausa"
          accessibilityLabel="Minuti di pausa"
        />
      ) : null}
    </View>
  );
}
