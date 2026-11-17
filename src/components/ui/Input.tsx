import { useState } from "react";
import { Pressable, TextInput, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { Mono } from "./Mono";
import { useColors } from "@/lib/theme";

type Props = React.ComponentProps<typeof TextInput> & {
  label?: string;
  className?: string;
};

export function Input({
  label,
  className,
  secureTextEntry,
  ...props
}: Props) {
  const colors = useColors();
  // `secureTextEntry` diventa l'interruttore dell'occhio: ogni campo password
  // dell'app lo eredita senza che chi lo usa debba saperlo.
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;

  return (
    <View className="gap-2">
      {label ? <Mono>{label}</Mono> : null}
      <View className="justify-center">
        <TextInput
          placeholderTextColor={colors.t4}
          secureTextEntry={isPassword && !revealed}
          className={cn(
            "rounded-[14px] border border-border bg-bg-1 px-4 py-3.5 font-sans text-[16px] text-t1",
            // Spazio per l'occhio: senza, il testo lungo ci finisce sotto.
            isPassword && "pr-14",
            className
          )}
          {...props}
        />
        {isPassword ? (
          <Pressable
            className="absolute right-1 h-12 w-12 items-center justify-center"
            hitSlop={6}
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={
              revealed ? "Nascondi la password" : "Mostra la password"
            }
          >
            <Icon
              name={revealed ? "eyeOff" : "eye"}
              size={20}
              color={revealed ? colors.gold : colors.t3}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
