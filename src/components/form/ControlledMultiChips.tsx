import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Pressable, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";

type Props<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  label: string;
  options: readonly string[];
};

/** RHF-bound multi-select chips (wrapping). Field value is a string[]; tap toggles. */
export function ControlledMultiChips<T extends FieldValues>({
  control,
  name,
  label,
  options,
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange } }) => {
        const selected: string[] = Array.isArray(value) ? value : [];
        return (
          <View className="gap-2">
            <Mono>{label}</Mono>
            <View className="flex-row flex-wrap gap-2">
              {options.map((opt) => {
                const active = selected.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    onPress={() =>
                      onChange(
                        active
                          ? selected.filter((v) => v !== opt)
                          : [...selected, opt]
                      )
                    }
                    className={cn(
                      "rounded-full px-4 py-2",
                      active ? "bg-gold-fill" : "border border-border-2"
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm font-sans-semibold",
                        active ? "text-gold-ink" : "text-t3"
                      )}
                    >
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      }}
    />
  );
}
