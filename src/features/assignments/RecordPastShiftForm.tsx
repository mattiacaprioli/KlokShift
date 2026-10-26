import { useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Switch } from "react-native";
import { ScrollView, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import {
  SHIFT_RANGE_ERROR,
  addDaysToDate,
  isValidShiftRange,
  shiftSlotLabel,
  toDateString,
  toTimeString,
  todayString,
} from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { VenuePicker } from "@/features/venues/VenuePicker";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useVenueStaff } from "@/features/staff/hooks";
import type { StaffMemberWithWaiter } from "@/features/staff/types";
import { useSelfStaff } from "@/features/staff/self";
import {
  StaffAssignPicker,
  defaultRoleFor,
} from "@/features/assignments/StaffAssignPicker";
import { useRecordPastShift } from "@/features/assignments/hooks";
import { DayPicker } from "@/features/shifts/DayPicker";
import { ShiftTimeFields } from "@/features/shifts/ShiftTimeFields";
import { shiftBreakError } from "@/features/shifts/breaks";
import { usePlanChecks } from "@/features/shifts/usePlanChecks";
import { useShiftBreak } from "@/features/shifts/useShiftBreak";
import {
  RECORD_INTRO,
  RECORD_NOTE_PLACEHOLDER,
  RECORD_NOTIFY_HINT,
  RECORD_NOTIFY_LABEL,
  RECORD_NOT_FINISHED,
  canRecordShift,
} from "@/features/shifts/recorded";

function defaultTime(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Ieri: il caso più comune di turno dimenticato. */
function yesterday(): Date {
  return new Date(`${addDaysToDate(todayString(), -1)}T00:00:00`);
}

type Props = {
  /** Il giorno passato scelto nell'agenda, se si arriva da lì. */
  initialDate?: Date;
  header: ReactNode;
};

/**
 * Registra un turno **già fatto** che non era stato pianificato: chi ha «Ore»
 * sceglie il giorno passato, l'orario e chi ha lavorato. Le persone risultano
 * presenti e le ore contano subito (`record_past_shift`), senza notifiche di
 * turno assegnato: è lavoro svolto, non un invito.
 *
 * Gemello del dialogo della dashboard (`RecordPastShiftDialog`): stesse frasi
 * (`recorded.ts`) e stessi avvisi sotto i nomi (`usePlanChecks`). «Già in
 * turno» qui conta doppio: di solito vuol dire che quel turno c'è già.
 */
export function RecordPastShiftForm({ initialDate, header }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { venuesWith, isOwner } = useOwnerVenues();
  const self = useSelfStaff();
  const hoursVenues = venuesWith("can_view_hours");
  const last = useLastVenue();
  // La sede proposta è l'ultima usata, se lì si registrano le ore.
  const [picked, setPicked] = useState<string | null>(null);
  const venueId =
    picked ??
    (hoursVenues.some((v) => v.id === last.venueId)
      ? last.venueId
      : hoursVenues[0]?.id);
  const venue = hoursVenues.find((v) => v.id === venueId) ?? null;

  const staffQuery = useVenueStaff(venueId);
  // Solo chi è attivo in organico (un invito in attesa il database lo rifiuta);
  // le proprie ore le registra solo il titolare («non decidi di te stesso»),
  // quindi per un collaboratore la propria riga sparisce.
  const staff = (staffQuery.data ?? []).filter(
    (m) => m.link_status === "active" && (isOwner || !self.isSelf(m.waiter_id))
  );
  const record = useRecordPastShift();

  const [date, setDate] = useState(() => initialDate ?? yesterday());
  const [start, setStart] = useState(defaultTime(8));
  const [end, setEnd] = useState(defaultTime(17));
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const pause = useShiftBreak(venue, toTimeString(start), toTimeString(end));

  const times = {
    date: toDateString(date),
    start_time: toTimeString(start),
    end_time: toTimeString(end),
  };
  const checks = usePlanChecks({ dates: [times.date], ...times });
  const finished = canRecordShift(times);
  const selectedIds = Object.keys(selected);

  function toggle(member: StaffMemberWithWaiter) {
    setSelected((prev) => {
      if (member.id in prev) {
        const next = { ...prev };
        delete next[member.id];
        return next;
      }
      return { ...prev, [member.id]: defaultRoleFor(member) };
    });
  }

  function setRole(staffId: string, roleId: string | null) {
    setSelected((prev) => ({ ...prev, [staffId]: roleId }));
  }

  /** Le persone sono della sede: cambiando sede la scelta si azzera. */
  function chooseVenue(id: string) {
    if (id === venueId) return;
    const hadSelection = selectedIds.length > 0;
    setSelected({});
    setPicked(id);
    last.choose(id);
    if (hadSelection) toast.show("Persone azzerate: erano di un'altra sede.");
  }

  function onSubmit() {
    if (!venueId) {
      toast.show("Non hai una sede su cui registrare le ore.", "error");
      return;
    }
    if (selectedIds.length === 0) {
      toast.show("Scegli almeno una persona.", "error");
      return;
    }
    if (!isValidShiftRange(times.start_time, times.end_time)) {
      toast.show(SHIFT_RANGE_ERROR, "error");
      return;
    }
    const breakError = shiftBreakError(times.start_time, times.end_time, pause.minutes);
    if (breakError) {
      toast.show(breakError, "error");
      return;
    }
    if (!finished) {
      toast.show(RECORD_NOT_FINISHED, "error");
      return;
    }
    record.mutate(
      {
        venue_id: venueId,
        // La fascia oraria, come i turni creati dall'app (mai la data).
        title: shiftSlotLabel(times.start_time),
        ...times,
        break_minutes: pause.minutes,
        note: note.trim() || null,
        staff: selectedIds.map((id) => ({
          venue_member_id: id,
          role_id: selected[id],
        })),
        notify,
      },
      {
        onSuccess: () => {
          toast.show("Turno registrato: le ore contano già.");
          router.back();
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Impossibile registrare il turno. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {header}
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="p-6 gap-7"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="-mt-2 text-[13px] leading-5 text-t3">{RECORD_INTRO}</Text>

        <VenuePicker value={venueId} onChange={chooseVenue} perm="can_view_hours" />

        <View className="gap-3">
          <Mono>Giorno</Mono>
          <DayPicker value={date} onChange={setDate} past />
        </View>

        <View className="gap-2">
          <ShiftTimeFields
            date={date}
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
            pause={{
              minutes: pause.minutes,
              paid: venue?.break_paid ?? false,
              onChange: pause.setMinutes,
            }}
          />
          {isValidShiftRange(times.start_time, times.end_time) && !finished ? (
            <Text className="text-xs font-sans-semibold text-error">
              {RECORD_NOT_FINISHED}
            </Text>
          ) : null}
        </View>

        <StaffAssignPicker
          staff={staff}
          loading={staffQuery.isLoading}
          value={selected}
          onToggle={toggle}
          onRoleChange={setRole}
          notesFor={(m) => checks.notesFor(m.person_id)}
        />

        <Input
          label="Nota (facoltativa)"
          value={note}
          onChangeText={setNote}
          placeholder={RECORD_NOTE_PLACEHOLDER}
          multiline
          numberOfLines={3}
          className="h-20"
          textAlignVertical="top"
        />

        <Card className="flex-row items-center justify-between gap-3 px-4 py-3.5">
          <View className="flex-1">
            <Text className="text-[15px] font-sans-semibold text-t1">
              {RECORD_NOTIFY_LABEL}
            </Text>
            <Text className="mt-0.5 text-[13px] text-t3">{RECORD_NOTIFY_HINT}</Text>
          </View>
          <Switch
            value={notify}
            onValueChange={setNotify}
            disabled={record.isPending}
            trackColor={{ false: "#2a241b", true: "#eab54c" }}
            thumbColor="#f8f4ed"
            ios_backgroundColor="#2a241b"
          />
        </Card>

        <GoldButton
          className="mt-1"
          label={
            record.isPending
              ? "Registrazione…"
              : selectedIds.length > 1
                ? `Registra per ${selectedIds.length} persone`
                : "Registra turno"
          }
          disabled={record.isPending}
          onPress={onSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
