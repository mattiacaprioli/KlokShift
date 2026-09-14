import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { ScrollView, Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { Mono } from "@/components/ui/Mono";
import { SelectChip } from "@/components/ui/SelectChip";
import { MONTH_NAMES, daysInMonth, formatBirthday } from "@/lib/format";

export type Birthday = { day: number; month: number };

/** Il campo legato a react-hook-form, come gli altri `Controlled*` del modulo. */
export function ControlledBirthday<T extends FieldValues>({
  control,
  name,
}: {
  control: Control<T>;
  name: Path<T>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange } }) => (
        <BirthdayField
          value={(value as Birthday | null) ?? null}
          onChange={onChange}
        />
      )}
    />
  );
}

/**
 * Il compleanno: mese e giorno, **senza anno**.
 *
 * Due strisce di chip e non un `DateTimePicker`, e non è una preferenza di
 * stile: il picker nativo chiede per forza un anno, e mostrarne uno che poi si
 * butta via è il modo più rapido per far credere a qualcuno di aver dato la
 * propria data di nascita. Qui l'anno non compare mai, perché non lo salviamo
 * (vedi 20260914160000) — e l'idioma delle chip è già quello del resto dei
 * moduli (`DayPicker`, `RoleMultiSelect`).
 *
 * Cambiare mese non azzera il giorno: si sposta al massimo consentito, così chi
 * ha scelto 31 e passa a novembre si ritrova sul 30 invece che su niente.
 */
export function BirthdayField({
  value,
  onChange,
}: {
  value: Birthday | null;
  onChange: (value: Birthday | null) => void;
}) {
  const month = value?.month ?? null;
  const day = value?.day ?? null;
  const max = month ? daysInMonth(month) : 31;

  function pickMonth(m: number) {
    const clamped = Math.min(day ?? 1, daysInMonth(m));
    onChange({ day: clamped, month: m });
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Mono>Compleanno (facoltativo)</Mono>
        {value ? (
          <Text className="text-sm font-sans-semibold text-gold">
            {formatBirthday(value.day, value.month)}
          </Text>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 20 }}
      >
        {MONTH_NAMES.map((name, i) => (
          <SelectChip
            key={name}
            label={name.slice(0, 3)}
            active={month === i + 1}
            onPress={() => pickMonth(i + 1)}
          />
        ))}
      </ScrollView>

      {/* I giorni compaiono solo dopo il mese: quanti sono dipende da quale. */}
      {month ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 20 }}
        >
          {Array.from({ length: max }, (_, i) => i + 1).map((d) => (
            <SelectChip
              key={d}
              label={String(d)}
              active={day === d}
              onPress={() => onChange({ day: d, month })}
            />
          ))}
        </ScrollView>
      ) : null}

      <Text className="text-[12px] text-t4">
        Lo vedono i locali in cui sei in organico, per farti gli auguri. Non
        salviamo l&apos;anno, quindi la tua età resta tua.
      </Text>

      {value ? (
        <GhostButton size="sm" label="Togli" onPress={() => onChange(null)} />
      ) : null}
    </View>
  );
}
