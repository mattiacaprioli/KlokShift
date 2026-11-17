import { useState } from "react";
import { ActivityIndicator, Modal } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { useCopyInternalShifts } from "@/features/assignments/hooks";
import { cn } from "@/lib/cn";
import { addDaysToDate, formatDate, formatShiftRange } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import { useToast } from "@/providers/Toast";
import {
  DUPLICATE_NOTHING_MISSING,
  DUPLICATE_NOTHING_PAST,
  classifyDuplicate,
  duplicateAllAnywayLabel,
  duplicateAlreadyThereText,
  duplicateAlreadyThereTitle,
  duplicateCreatedToast,
  duplicateOnlyMissingLabel,
  duplicateSkippedPastText,
  duplicateWithStaffHint,
  splitAlreadyThere,
  weekDateMap,
  weekRangeLabel,
} from "./duplicate";
import { DUPLICATE_AS_DRAFT_SHORT } from "./drafts";
import { useOwnerShiftsRange } from "./hooks";
import { useColors } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

/** Righe di «Vedi i turni»: la settimana intera può essere lunga. */
const PREVIEW_ROWS = 12;

const turni = (n: number) => `${n} ${n === 1 ? "turno" : "turni"}`;

/**
 * «Copia la settimana» dall'agenda dell'app: la settimana che si sta
 * guardando, copiata su quella dopo (o più avanti). Stesse regole e frasi della
 * dashboard (`duplicate.ts`); qui solo la settimana — il mese resta sulla
 * dashboard, dove si pianifica in grande.
 *
 * Rifatta il 15/11/2026 per chi non legge le finestre: una frase «da → a», due
 * pulsanti per le persone e l'elenco dei turni chiuso. Il secondo passo compare
 * **solo** se nella settimana d'arrivo ci sono già turni uguali (come Skello e
 * When I Work, che chiedono solo davanti a un conflitto): copiare solo quelli
 * che mancano o tutto lo stesso. Niente «Sostituisci»: i turni d'arrivo possono
 * essere pubblicati e confermati.
 *
 * ⚠️ Ogni copia resta nella sede del turno che l'ha generata: ci pensa
 * `getInternalShiftPlans`, che porta il `venue_id` per piano.
 */
export function DuplicateWeekModal({
  monday,
  venueIds,
  onClose,
}: {
  /** Il lunedì ("YYYY-MM-DD") della settimana da copiare. */
  monday: string;
  /** Le sedi accese nell'agenda su cui si possono fare turni. */
  venueIds: string[];
  onClose: () => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const copy = useCopyInternalShifts();
  const [weeks, setWeeks] = useState(1);
  const [withStaff, setWithStaff] = useState(true);
  const [showList, setShowList] = useState(false);
  const [step, setStep] = useState<"main" | "already">("main");

  const sourceQuery = useOwnerShiftsRange(monday, addDaysToDate(monday, 6), venueIds);
  const target = addDaysToDate(monday, weeks * 7);
  const targetQuery = useOwnerShiftsRange(target, addDaysToDate(target, 6), venueIds);

  const now = useNow();
  const shifts = sourceQuery.data ?? [];
  const dateMap = weekDateMap(shifts, weeks);
  const { copyable, skippedCancelled, skippedUnplanned, skippedPast } =
    classifyDuplicate(shifts, dateMap, now);
  const { missing, alreadyThere } = splitAlreadyThere(
    copyable,
    dateMap,
    targetQuery.data ?? []
  );
  const sourceLabel = weekRangeLabel(monday);
  const targetLabel = weekRangeLabel(target);
  const preview = copyable.slice(0, PREVIEW_ROWS);
  const excluded = [
    skippedCancelled > 0 ? `${skippedCancelled} annullati` : null,
    skippedUnplanned > 0 ? `${skippedUnplanned} fuori turno` : null,
  ].filter(Boolean);

  function submit(list: typeof copyable) {
    copy.mutate(
      { sourceIds: list.map((s) => s.id), dateMap, withStaff },
      {
        onSuccess: (created) => {
          toast.show(duplicateCreatedToast(created.length, targetLabel));
          onClose();
        },
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile copiare la settimana."), "error"),
      }
    );
  }

  function onCopy() {
    if (alreadyThere.length > 0) setStep("already");
    else submit(copyable);
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* Lo sfondo che chiude è un fratello della scheda, non il suo
          contenitore: una scheda dentro un `Pressable` si prendeva il tocco e
          l'elenco dei turni non scorreva più. */}
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: withAlpha(colors.scrim, 0.66) }}
      >
        <Pressable
          className="absolute inset-0"
          onPress={copy.isPending ? undefined : onClose}
          accessibilityLabel="Chiudi"
        />
        <View className="max-h-[88%] w-full rounded-3xl border border-border-2 bg-bg-card p-6">
          {step === "already" ? (
            <View>
              {/* Sfondo inline: `bg-warning/15` passerebbe da `color-mix`, che
                  react-native-css non regge. */}
              <View
                className="h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: withAlpha(colors.warning, 0.15) }}
              >
                <Icon name="alert" size={24} color={colors.warning} />
              </View>
              <Text className="mt-4 text-xl font-sans-bold text-t1">
                {duplicateAlreadyThereTitle(alreadyThere.length)}
              </Text>
              <Text className="mt-2 text-base leading-6 text-t2">
                {duplicateAlreadyThereText(alreadyThere.length, targetLabel)}
              </Text>
              {missing.length === 0 ? (
                <Text className="mt-3 text-base leading-6 text-t1">
                  {DUPLICATE_NOTHING_MISSING}
                </Text>
              ) : null}

              <View className="mt-6 gap-2.5">
                {missing.length > 0 ? (
                  <GoldButton
                    label={copy.isPending ? "Copia in corso…" : duplicateOnlyMissingLabel(missing.length)}
                    disabled={copy.isPending}
                    onPress={() => submit(missing)}
                  />
                ) : null}
                <GhostButton
                  label={duplicateAllAnywayLabel(copyable.length)}
                  disabled={copy.isPending}
                  onPress={() => submit(copyable)}
                />
                <Pressable
                  disabled={copy.isPending}
                  onPress={() => setStep("main")}
                  className="items-center py-2"
                >
                  <Text className="text-[15px] text-t3">Indietro</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Text className="text-xl font-sans-bold text-t1">Copia la settimana</Text>

              {sourceQuery.isLoading ? (
                <ActivityIndicator color={colors.gold} className="mt-6" />
              ) : copyable.length === 0 ? (
                <Text className="mt-4 text-base leading-6 text-t2">
                  {skippedPast > 0
                    ? DUPLICATE_NOTHING_PAST
                    : "Questa settimana non ha turni da copiare."}
                </Text>
              ) : (
                <ScrollView
                  className="mt-5"
                  style={{ flexGrow: 0, flexShrink: 1 }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Due frasi, non «Da» e «A»: si leggono come si direbbero
                      (15/11/2026, la freccia in mezzo non diceva niente). */}
                  <Text className="text-base text-t2">Copia i turni di questa settimana</Text>
                  <View className="mt-2 flex-row items-center justify-between gap-3 rounded-2xl border border-border-2 bg-bg-1 px-4 py-3.5">
                    <Text className="text-lg font-sans-semibold text-t1">{sourceLabel}</Text>
                    <Text className="text-[15px] text-t2">{turni(copyable.length)}</Text>
                  </View>

                  <Text className="mt-5 text-base text-t2">sulla settimana</Text>
                  <View className="mt-2 rounded-2xl border border-gold px-2 py-2">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        disabled={weeks <= 1 || copy.isPending}
                        onPress={() => setWeeks((w) => Math.max(1, w - 1))}
                        accessibilityRole="button"
                        accessibilityLabel="Settimana prima"
                        className="h-11 w-11 items-center justify-center rounded-full"
                        style={weeks <= 1 ? { opacity: 0.3 } : undefined}
                      >
                        <Icon name="chevL" size={20} color={colors.gold} />
                      </Pressable>
                      <View className="flex-1 items-center">
                        <Text className="text-lg font-sans-semibold text-t1">{targetLabel}</Text>
                        <Text className="text-[13px] text-t3">
                          {weeks === 1 ? "la settimana dopo" : `fra ${weeks} settimane`}
                        </Text>
                      </View>
                      <Pressable
                        disabled={copy.isPending}
                        onPress={() => setWeeks((w) => w + 1)}
                        accessibilityRole="button"
                        accessibilityLabel="Settimana dopo"
                        className="h-11 w-11 items-center justify-center rounded-full"
                      >
                        <Icon name="chevR" size={20} color={colors.gold} />
                      </Pressable>
                    </View>
                  </View>

                  <Text className="mt-6 text-base font-sans-semibold text-t1">
                    Con le stesse persone?
                  </Text>
                  <View className="mt-2.5 flex-row gap-2.5">
                    {([true, false] as const).map((v) => {
                      const on = withStaff === v;
                      return (
                        <Pressable
                          key={String(v)}
                          onPress={() => setWithStaff(v)}
                          disabled={copy.isPending}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          className={cn(
                            "flex-1 items-center rounded-2xl border py-3.5",
                            on ? "border-gold" : "border-border-2"
                          )}
                          style={on ? { backgroundColor: withAlpha(colors.gold, 0.1) } : undefined}
                        >
                          <Text
                            className={cn(
                              "text-base",
                              on ? "font-sans-semibold text-t1" : "text-t2"
                            )}
                          >
                            {v ? "Sì" : "No, solo i turni"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mt-2 text-[13px] leading-[18px] text-t3">
                    {duplicateWithStaffHint(withStaff)}
                  </Text>

                  {skippedPast > 0 ? (
                    <Text className="mt-4 text-[13px] leading-[18px] text-t3">
                      {duplicateSkippedPastText(skippedPast)}
                    </Text>
                  ) : null}

                  {/* L'elenco c'è per chi lo vuole, chiuso: il numero basta. */}
                  <Pressable
                    onPress={() => setShowList((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showList }}
                    className="mt-5 flex-row items-center gap-1.5 py-1"
                  >
                    <Text className="text-[15px] font-sans-semibold text-gold">
                      {showList ? "Nascondi i turni" : `Vedi i ${turni(copyable.length)}`}
                    </Text>
                    <Icon
                      name="chevR"
                      size={16}
                      color={colors.gold}
                      style={{ transform: [{ rotate: showList ? "-90deg" : "90deg" }] }}
                    />
                  </Pressable>
                  {showList ? (
                    <View className="mt-2 gap-1.5">
                      {preview.map((s) => (
                        <View
                          key={s.id}
                          className="flex-row items-center gap-2 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
                        >
                          <Text className="flex-1 text-sm text-t1" numberOfLines={1}>
                            {s.title}
                          </Text>
                          <Text className="font-mono text-xs text-t3">
                            {formatShiftRange(s.start_time, s.end_time)}
                          </Text>
                          <Text className="w-24 text-right text-xs text-t2">
                            {formatDate(dateMap[s.date])}
                          </Text>
                        </View>
                      ))}
                      {copyable.length > preview.length ? (
                        <Text className="mt-1 text-xs text-t3">
                          e altri {copyable.length - preview.length} turni.
                        </Text>
                      ) : null}
                      {excluded.length > 0 ? (
                        <Text className="mt-1 text-xs text-t3">
                          Non si copiano: {excluded.join(", ")}.
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </ScrollView>
              )}

              <View className="mt-6 gap-2">
                {copyable.length > 0 ? (
                  <>
                    <GoldButton
                      label={
                        copy.isPending
                          ? "Copia in corso…"
                          : targetQuery.isLoading
                            ? "Un momento…"
                            : `Copia ${turni(copyable.length)}`
                      }
                      // Senza la settimana d'arrivo non si sa se ci sono doppioni.
                      disabled={copy.isPending || targetQuery.isLoading}
                      onPress={onCopy}
                    />
                    <Text className="text-center text-[13px] text-t3">
                      {DUPLICATE_AS_DRAFT_SHORT}
                    </Text>
                  </>
                ) : null}
                <Pressable disabled={copy.isPending} onPress={onClose} className="items-center py-2">
                  <Text className="text-[15px] text-t3">
                    {copyable.length > 0 ? "Annulla" : "Chiudi"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
