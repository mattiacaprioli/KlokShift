import { useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import {
  SHIFT_RANGE_ERROR,
  isValidShiftRange,
  shiftSlotLabel,
  timeToDate,
  toDateString,
  toTimeString,
} from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { VenuePicker } from "@/features/venues/VenuePicker";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { useVenueStaff } from "@/features/staff/hooks";
import type { StaffMemberWithWaiter } from "@/features/staff/types";
import { useVenueRoles } from "@/features/roles/hooks";
import { RequireConfirmationField } from "@/features/assignments/RequireConfirmationField";
import { RoleRequirementsField } from "@/features/assignments/RoleRequirementsField";
import {
  StaffAssignPicker,
  defaultRoleFor,
} from "@/features/assignments/StaffAssignPicker";
import { useCreateInternalShifts } from "@/features/assignments/hooks";
import { DayPicker } from "@/features/shifts/DayPicker";
import { RepeatDaysField } from "@/features/shifts/RepeatDaysField";
import { ShiftTimeFields } from "@/features/shifts/ShiftTimeFields";
import { SkippedDaysNotes } from "@/features/shifts/SkippedDaysNotes";
import { shiftBreakError } from "@/features/shifts/breaks";
import {
  plannedDatesOf,
  shortDays,
  skippedDaysOf,
  staffForDate,
  weekOf,
} from "@/features/shifts/repeat";
import {
  PLAN_ENDED,
  RECORD_ACTION,
  endedDates,
  planEndedExtra,
} from "@/features/shifts/recorded";
import { usePlanChecks } from "@/features/shifts/usePlanChecks";
import { useShiftBreak } from "@/features/shifts/useShiftBreak";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { ShiftTemplate } from "@/features/shiftTemplates/api";
import { SaveTemplateModal } from "@/features/shiftTemplates/SaveTemplateModal";
import { ShiftTemplatesButton } from "@/features/shiftTemplates/ShiftTemplatesButton";
import {
  applicableRoleTargets,
  type ShiftTemplateInput,
} from "@/features/shiftTemplates/template";

function defaultTime(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

type Props = {
  /** Il giorno da cui partire, se si arriva dall'agenda con una data scelta. */
  initialDate?: Date;
  /**
   * L'intestazione della schermata, con al posto giusto (in alto a destra) le
   * azioni del form: oggi «Modelli». Il titolo resta della schermata, lo stato
   * che quelle azioni riempiono è del form.
   */
  header: (actions: ReactNode) => ReactNode;
};

/**
 * Crea un turno e lo assegna a zero, una o più persone del team, anche su
 * più giorni della settimana. Senza nessuno il turno nasce «da coprire», come
 * dalla dashboard: fino al 26/10/2026 qui serviva almeno una persona, e la
 * stessa cosa si faceva in un modo sul web e in un altro sul telefono.
 *
 * ⚠️ **La sede è un campo del form, non un contesto.** È il perno del
 * riposizionamento del 14/09/2026: non si "entra" in una sede per creare i suoi
 * turni — si crea un turno e si dice dove. Il form la possiede (`useLastVenue`,
 * che ricorda l'ultima usata), e da lì discendono organico e mansioni
 * selezionabili: `useVenueStaff`/`useVenueRoles` filtrano già per sede, e non
 * hanno avuto bisogno di cambiare di una riga.
 */
export function StaffShiftForm({ initialDate, header }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { venueId, choose } = useLastVenue();
  const { venues, canUseOperations, canAny } = useOwnerVenues();
  const canRecord = canUseOperations && canAny("can_view_hours");
  const venue = venues.find((v) => v.id === venueId) ?? null;
  const staffQuery = useVenueStaff(venueId);
  // Solo staff confermato: gli inviti ancora da accettare non sono assegnabili.
  const staff = (staffQuery.data ?? []).filter(
    (m) => m.link_status === "active"
  );
  const rolesQuery = useVenueRoles(venueId);
  const roles = rolesQuery.data ?? [];
  const create = useCreateInternalShifts();

  const [date, setDate] = useState(() => initialDate ?? new Date());
  // Giorni **in più** su cui ripetere lo stesso turno («Ripeti anche il…»).
  const [extraDates, setExtraDates] = useState<string[]>([]);
  /**
   * Chi va messo in turno anche nei giorni in cui ha un'assenza approvata. Di
   * norma lì resta fuori (`staffForDate`); il titolare può forzare.
   */
  const [forcedAbsent, setForcedAbsent] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(defaultTime(8));
  const [end, setEnd] = useState(defaultTime(17));
  // Chi è selezionato **e** in che ruolo: la chiave è la persona, il valore il
  // ruolo che ricopre in questo turno (null = non ancora scelto).
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const pause = useShiftBreak(venue, toTimeString(start), toTimeString(end));
  // Il modello da cui si è partiti: dà il titolo al turno e il nome proposto
  // a «Salva come modello».
  const [template, setTemplate] = useState<{ id: string; name: string } | null>(
    null
  );
  const [saving, setSaving] = useState<ShiftTemplateInput | null>(null);

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

  function setTarget(roleId: string, delta: number) {
    setTargets((prev) => ({
      ...prev,
      [roleId]: Math.max(0, Math.min(20, (prev[roleId] ?? 0) + delta)),
    }));
  }

  const selectedIds = Object.keys(selected);
  const plannedDates = plannedDatesOf(toDateString(date), extraDates);
  const checks = usePlanChecks({
    dates: plannedDates,
    start_time: toTimeString(start),
    end_time: toTimeString(end),
  });
  const selectedStaff = staff.filter((m) => m.id in selected);
  // Il passato non si pianifica (`create_shifts` lo rifiuta): un orario già
  // finito lo si dice sotto gli orari, e porta a «Turno già fatto».
  const rangeValid = isValidShiftRange(toTimeString(start), toTimeString(end));
  const ended = rangeValid
    ? endedDates(plannedDates, toTimeString(start), toTimeString(end))
    : [];
  const mainEnded = ended.includes(toDateString(date));
  const endedMessage = mainEnded
    ? PLAN_ENDED
    : ended.length > 0
      ? planEndedExtra(shortDays(ended))
      : null;
  // Chi resta fuori da qualche copia per un'assenza approvata: la stessa regola
  // del pannello web, anche con un giorno solo.
  const skippedDays = skippedDaysOf(selectedStaff, (m) =>
    checks.absenceHitsFor(m.person_id)
  );

  /**
   * Cambiando settimana i giorni spuntati prima non esistono più in griglia: si
   * azzerano invece di restare invisibili e creare turni a sorpresa.
   */
  function chooseDate(next: Date) {
    setDate(next);
    const week = weekOf(toDateString(next));
    setExtraDates((prev) => prev.filter((d) => week.includes(d)));
  }

  function toggleExtraDate(day: string) {
    setExtraDates((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function toggleForced(id: string) {
    setForcedAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Cambiare sede azzera persone e fabbisogni.
   *
   * Non è pulizia estetica: le chiavi di `selected` sono `staff_members.id`
   * della sede precedente e quelle di `targets` sono `venue_roles.id` della
   * sede precedente. Portarle su un turno di un'altra sede produce
   * assegnazioni incoerenti che **il database accetta** — nessuna FK lega
   * `shift_assignments.venue_member_id` alla sede del turno — e che poi nessuna
   * schermata sa leggere.
   *
   * Reset silenzioso, con un avviso solo se c'era qualcosa da perdere: una
   * conferma a ogni cambio punirebbe l'uso normale, e la selezione si rifà in
   * tre tocchi.
   */
  function chooseVenue(id: string) {
    if (id === venueId) return;
    const hadSelection = selectedIds.length > 0 || Object.keys(targets).length > 0;
    setSelected({});
    setTargets({});
    setForcedAbsent(new Set());
    // I modelli sono della sede: quello applicato non vale per l'altra.
    setTemplate(null);
    choose(id);
    if (hadSelection) {
      toast.show("Persone e posti per ruolo azzerati: erano di un'altra sede.");
    }
  }

  /**
   * Riempie il form dal modello. Giorno e persone restano quelli scelti: il
   * modello non li ricorda, e toglierli punirebbe chi li ha già messi.
   */
  function applyTemplate(t: ShiftTemplate) {
    setStart(timeToDate(t.start_time));
    setEnd(timeToDate(t.end_time));
    pause.setMinutes(t.break_minutes);
    setTargets(
      Object.fromEntries(
        applicableRoleTargets(t.role_targets, roles).map((r) => [
          r.role_id,
          r.count,
        ])
      )
    );
    setNote(t.description ?? "");
    setRequireConfirmation(t.require_confirmation);
    setTemplate({ id: t.id, name: t.name });
  }

  /** Orario e pausa validi: le stesse regole del turno, persone a parte. */
  function timesError(): string | null {
    if (!isValidShiftRange(toTimeString(start), toTimeString(end))) {
      return SHIFT_RANGE_ERROR;
    }
    return shiftBreakError(toTimeString(start), toTimeString(end), pause.minutes);
  }

  function onSaveTemplate() {
    if (!venueId) {
      toast.show("Configura prima la tua sede.", "error");
      return;
    }
    const error = timesError();
    if (error) {
      toast.show(error, "error");
      return;
    }
    setSaving({
      name: template?.name ?? shiftSlotLabel(toTimeString(start)),
      start_time: toTimeString(start),
      end_time: toTimeString(end),
      break_minutes: pause.minutes,
      description: note.trim() || null,
      require_confirmation: requireConfirmation,
      role_targets: roles
        .map((role) => ({ role_id: role.id, count: targets[role.id] ?? 0 }))
        .filter((t) => t.count > 0),
    });
  }

  function onSubmit() {
    if (!venueId) {
      toast.show("Configura prima la tua sede.", "error");
      return;
    }
    const error = timesError();
    if (error) {
      toast.show(error, "error");
      return;
    }
    if (endedMessage) {
      toast.show(endedMessage, "error");
      return;
    }
    const roleTargets = roles
      .map((role) => ({ role_id: role.id, count: targets[role.id] ?? 0 }))
      .filter((t) => t.count > 0);
    const people = selectedIds.map((id) => ({
      venue_member_id: id,
      role_id: selected[id],
    }));
    // Un turno o sette passano dalla stessa RPC, tutto o niente: la data è
    // l'unica cosa che cambia fra le copie.
    create.mutate(
      plannedDates.map((dateStr) => ({
        venue_id: venueId,
        // Il nome del modello se si è partiti da uno, altrimenti la fascia
        // oraria. Mai la data: è già una colonna del turno, e ripeterla nel
        // titolo riempiva la riga più in vista di ogni card con l'informazione
        // che la riga sotto dava di nuovo.
        title: template?.name ?? shiftSlotLabel(toTimeString(start)),
        date: dateStr,
        start_time: toTimeString(start),
        end_time: toTimeString(end),
        description: note.trim() || null,
        require_confirmation: requireConfirmation,
        break_minutes: pause.minutes,
        // Chi quel giorno è assente resta fuori da quella copia sola.
        staff: staffForDate(people, dateStr, skippedDays, forcedAbsent),
        roleTargets,
      })),
      {
        onSuccess: () => {
          toast.show(
            plannedDates.length > 1
              ? `Creati ${plannedDates.length} turni`
              : selectedIds.length === 0
                ? "Turno creato: è da coprire"
                : "Turno assegnato"
          );
          router.back();
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Impossibile creare il turno. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      {header(
        <ShiftTemplatesButton
          venueId={venueId}
          activeId={template?.id ?? null}
          onApply={applyTemplate}
        />
      )}
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="p-6 gap-7"
        keyboardShouldPersistTaps="handled"
      >
        {/* Primo campo: tutto il resto del form dipende da questa risposta. */}
        <VenuePicker value={venueId} onChange={chooseVenue} />

        <View className="gap-3">
          <Mono>Giorno</Mono>
          <DayPicker value={date} onChange={chooseDate} />
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
          {endedMessage ? (
            <Text className="text-xs font-sans-semibold text-error">
              {endedMessage}
            </Text>
          ) : null}
          {mainEnded && canRecord ? (
            <Pressable
              onPress={() =>
                router.replace(`/(manager)/shift/record?date=${toDateString(date)}`)
              }
              accessibilityRole="button"
              hitSlop={8}
              className="self-start"
            >
              <Text className="text-xs font-sans-semibold text-gold">
                {RECORD_ACTION}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <RepeatDaysField
          date={toDateString(date)}
          extraDates={extraDates}
          onToggle={toggleExtraDate}
          isClosed={(day) =>
            rangeValid &&
            endedDates([day], toTimeString(start), toTimeString(end)).length > 0
          }
        />

        <RoleRequirementsField
          roles={roles}
          targets={targets}
          onChange={setTarget}
          assignedRoleIds={selectedIds.map((id) => selected[id])}
        />

        <StaffAssignPicker
          staff={staff}
          loading={staffQuery.isLoading}
          value={selected}
          onToggle={toggle}
          onRoleChange={setRole}
          notesFor={(m) => checks.notesFor(m.person_id)}
        />

        <SkippedDaysNotes
          staff={selectedStaff.filter((m) => skippedDays.has(m.id))}
          skippedDays={skippedDays}
          forced={forcedAbsent}
          onToggle={toggleForced}
        />

        <RequireConfirmationField
          value={requireConfirmation}
          onChange={setRequireConfirmation}
          disabled={create.isPending}
        />

        <Input
          label="Note (facoltative)"
          value={note}
          onChangeText={setNote}
          placeholder="Es. divisa nera, servizio serale"
          multiline
          numberOfLines={3}
          className="h-20"
          textAlignVertical="top"
        />

        <GoldButton
          className="mt-1"
          label={
            create.isPending
              ? "Creazione…"
              : plannedDates.length > 1
                ? `Crea ${plannedDates.length} turni`
                : selectedIds.length === 0
                  ? "Crea turno da coprire"
                  : selectedIds.length > 1
                    ? `Assegna a ${selectedIds.length} persone`
                    : "Assegna turno"
          }
          disabled={create.isPending}
          onPress={onSubmit}
        />
        {/* Non chiede persone: il modello non le ricorda. */}
        <GhostButton
          className="-mt-4"
          label="Salva come modello"
          disabled={create.isPending}
          onPress={onSaveTemplate}
        />
      </ScrollView>

      {saving && venueId ? (
        <SaveTemplateModal
          venueId={venueId}
          template={saving}
          onSaved={setTemplate}
          onClose={() => setSaving(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
