import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PickerField } from "@/components/form/ControlledPicker";
import { userErrorMessage } from "@/lib/errors";
import { toDateString } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { Pressable, Text, View } from "@/tw";
import type { Venue } from "./api";
import { closureRangeText, upcomingClosures, WEEKDAYS } from "./closures";
import {
  useDeleteVenueClosure,
  useSaveVenueClosure,
  useSetVenueRestDays,
  useVenueCalendar,
} from "./hooks";

const asDate = (d: string) => new Date(`${d}T00:00:00`);

/**
 * I giorni di chiusura di una sede: il riposo settimanale, le chiusure di ogni
 * anno (Ferragosto, Natale) e quelle una tantum. Li vedono tutti nei Turni; li
 * scrive chi ha «Turni» o «Dati della sede».
 */
export function VenueClosuresCard({ venue, canEdit }: { venue: Venue; canEdit: boolean }) {
  const toast = useToast();
  const { calendar } = useVenueCalendar([venue.id]);
  const save = useSaveVenueClosure();
  const remove = useDeleteVenueClosure();
  const setRest = useSetVenueRestDays();
  const today = toDateString(new Date());
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [yearly, setYearly] = useState(false);
  const upcoming = upcomingClosures(calendar.closures, venue.id, today);
  const rest = calendar.restDays[venue.id] ?? [];

  function toggleRest(iso: number) {
    const next = rest.includes(iso) ? rest.filter((d) => d !== iso) : [...rest, iso];
    setRest.mutate(
      { venueId: venue.id, days: next },
      { onError: (e) => toast.show(userErrorMessage(e, "Impossibile salvare. Riprova."), "error") }
    );
  }

  function onSave() {
    save.mutate(
      { venueId: venue.id, start, end: end < start ? start : end, reason, repeatYearly: yearly },
      {
        onSuccess: () => {
          toast.show(yearly ? "Chiusura aggiunta, ogni anno" : "Chiusura aggiunta");
          setAdding(false);
          setReason("");
          setYearly(false);
        },
        onError: (e) => toast.show(userErrorMessage(e, "Impossibile salvare. Riprova."), "error"),
      }
    );
  }

  return (
    <View className="gap-2">
      <SectionHeader className="mb-0" title={`Giorni di chiusura · ${venue.name}`} />
      <Card className="gap-4 px-4 py-3.5">
        <View className="gap-2">
          <Mono>Riposo settimanale</Mono>
          <View className="flex-row gap-1.5">
            {WEEKDAYS.map((w) => (
              <Chip
                key={w.iso}
                label={w.short}
                active={rest.includes(w.iso)}
                gold={rest.includes(w.iso)}
                onPress={canEdit && !setRest.isPending ? () => toggleRest(w.iso) : undefined}
                accessibilityLabel={`Chiusa il ${w.long}`}
              />
            ))}
          </View>
          <Text className="text-[13px] leading-5 text-t3">
            {rest.length > 0
              ? "Quei giorni sono chiusi ogni settimana."
              : canEdit
                ? "Tocca i giorni in cui la sede è chiusa ogni settimana."
                : "Nessun giorno di riposo fisso."}
          </Text>
        </View>

        <View className="gap-2 border-t border-border-1 pt-3">
          <Mono>Chiusure</Mono>
          {upcoming.length === 0 ? (
            <Text className="text-[13px] leading-5 text-t3">
              Nessuna chiusura in programma. Aggiungi Ferragosto, le ferie della
              sede o un giorno di lavori: il team li vede nei turni.
            </Text>
          ) : (
            upcoming.map((c) => (
              <View key={c.id} className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-[15px] font-sans-semibold text-t1">
                    {closureRangeText(c)}
                  </Text>
                  {c.reason ? <Text className="text-[13px] text-t3">{c.reason}</Text> : null}
                </View>
                {canEdit ? (
                  <Pressable
                    onPress={() =>
                      remove.mutate(c.id, {
                        onSuccess: () => toast.show("Chiusura tolta"),
                        onError: (e) => toast.show(userErrorMessage(e), "error"),
                      })
                    }
                    disabled={remove.isPending}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Togli la chiusura del ${closureRangeText(c)}`}
                  >
                    <Text className="text-sm font-sans-semibold text-gold">Togli</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>

        {canEdit && adding ? (
          <View className="gap-3 border-t border-border-1 pt-3">
            <PickerField
              mode="date"
              label="Dal"
              value={asDate(start)}
              onChange={(d) => {
                const next = toDateString(d);
                setStart(next);
                if (end < next) setEnd(next);
              }}
            />
            <PickerField
              mode="date"
              label="Al"
              value={asDate(end < start ? start : end)}
              onChange={(d) => setEnd(toDateString(d))}
            />
            <Input
              label="Motivo (facoltativo)"
              value={reason}
              onChangeText={setReason}
              placeholder="Es. Ferragosto"
              maxLength={80}
            />
            <View className="flex-row items-center gap-3">
              <Chip label="Ogni anno" active={yearly} gold={yearly} onPress={() => setYearly((v) => !v)} />
              <Text className="flex-1 text-[13px] leading-5 text-t3">
                {yearly ? "Torna ogni anno nelle stesse date." : "Solo quest'anno."}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <GoldButton
                className="flex-1"
                size="sm"
                label={save.isPending ? "Salvo…" : "Aggiungi"}
                disabled={save.isPending}
                onPress={onSave}
              />
              <GhostButton
                className="flex-1"
                size="sm"
                label="Annulla"
                onPress={() => setAdding(false)}
              />
            </View>
          </View>
        ) : canEdit ? (
          <GhostButton size="sm" label="Aggiungi una chiusura" onPress={() => setAdding(true)} />
        ) : null}
      </Card>
    </View>
  );
}
