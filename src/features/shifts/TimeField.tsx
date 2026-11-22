import { useState } from "react";
import { Modal, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { toTimeString } from "@/lib/format";
import { useColors, useScheme } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

type Props = {
  label?: string;
  value: Date;
  onChange: (d: Date) => void;
  className?: string;
  /** «date»: il giorno al posto dell'ora (la correzione delle timbrature). */
  mode?: "time" | "date";
};

const dayLabel = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Big tappable time field (prototype's "Dalle"/"Alle"). iOS opens a bottom
 * spinner sheet; Android the native time dialog. Always 24h. */
export function TimeField({ label, value, onChange, className, mode = "time" }: Props) {
  const colors = useColors();
  const scheme = useScheme();
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState(value);

  function open() {
    setDraft(value);
    setShow(true);
  }

  return (
    <View className={className}>
      {label ? <Mono className="mb-2">{label}</Mono> : null}
      <Pressable
        onPress={open}
        // Altezza fissa: giorno e ora hanno caratteri diversi, e affiancati
        // devono restare alti uguali.
        className="h-16 justify-center rounded-2xl border border-border bg-bg-1 px-4"
      >
        <Text
          className={
            mode === "date"
              ? "font-sans-medium text-[20px] text-t1"
              : "font-sans-medium text-[26px] text-t1"
          }
          numberOfLines={1}
        >
          {mode === "date" ? dayLabel.format(value) : toTimeString(value)}
        </Text>
      </Pressable>

      {Platform.OS === "android" && show ? (
        <DateTimePicker
          value={value}
          mode={mode}
          is24Hour
          onChange={(_, d) => {
            setShow(false);
            if (d) onChange(d);
          }}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal
          visible={show}
          transparent
          animationType="slide"
          onRequestClose={() => setShow(false)}
        >
          <Pressable
            onPress={() => setShow(false)}
            style={{ flex: 1, backgroundColor: withAlpha(colors.scrim, 0.6) }}
            className="justify-end"
          >
            <Pressable
              onPress={() => {}}
              className="rounded-t-3xl border-t border-border-2 bg-bg-card px-6 pb-8 pt-3"
            >
              <View className="items-center">
                <DateTimePicker
                  value={draft}
                  mode={mode}
                  display="spinner"
                  themeVariant={scheme}
                  is24Hour
                  onChange={(_, d) => d && setDraft(d)}
                />
              </View>
              <GoldButton
                label="Fatto"
                onPress={() => {
                  onChange(draft);
                  setShow(false);
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
