import { useState } from "react";
import { Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Pressable, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { formatDate, formatTime, toDateString, toTimeString } from "@/lib/format";
import { useColors, useScheme } from "@/lib/theme";

type Props<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  label: string;
  mode: "date" | "time";
};

/** RHF-bound date/time picker. iOS shows an inline compact control; Android a dialog. */
export function ControlledPicker<T extends FieldValues>({
  control,
  name,
  label,
  mode,
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange } }) => (
        <PickerField
          label={label}
          mode={mode}
          value={value as Date}
          onChange={onChange}
        />
      )}
    />
  );
}

export function PickerField({
  label,
  mode,
  value,
  onChange,
}: {
  label: string;
  mode: "date" | "time";
  value: Date;
  onChange: (d: Date) => void;
}) {
  const colors = useColors();
  const scheme = useScheme();
  const [show, setShow] = useState(false);
  const formatted =
    mode === "date"
      ? formatDate(toDateString(value))
      : formatTime(toTimeString(value));

  if (Platform.OS === "ios") {
    return (
      <View className="flex-row items-center justify-between">
        <Mono>{label}</Mono>
        <DateTimePicker
          value={value}
          mode={mode}
          display="compact"
          themeVariant={scheme}
          accentColor={colors.gold}
          onChange={(_, d) => d && onChange(d)}
        />
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Mono>{label}</Mono>
      <Pressable
        onPress={() => setShow(true)}
        className="rounded-[14px] border border-border bg-bg-1 px-4 py-3.5"
      >
        <Text className="font-sans text-base text-t1">{formatted}</Text>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={value}
          mode={mode}
          onChange={(_, d) => {
            setShow(false);
            if (d) onChange(d);
          }}
        />
      ) : null}
    </View>
  );
}
