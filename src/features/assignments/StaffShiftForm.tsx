import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { ScrollView, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import {
  SHIFT_RANGE_ERROR,
  isValidShiftRange,
  shiftSlotLabel,
  toDateString,
  toTimeString,
} from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { VenuePicker } from "@/features/venues/VenuePicker";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { useVenueStaff } from "@/features/staff/hooks";
import type { StaffMemberWithWaiter } from "@/features/staff/api";
import { useVenueRoles } from "@/features/roles/hooks";
import { RequireConfirmationField } from "@/features/assignments/RequireConfirmationField";
import { RoleRequirementsField } from "@/features/assignments/RoleRequirementsField";
import {
  StaffAssignPicker,
  defaultRoleFor,
} from "@/features/assignments/StaffAssignPicker";
import { useCreateInternalShift } from "@/features/assignments/hooks";
import { DayPicker } from "@/features/shifts/DayPicker";
import { ShiftTimeFields } from "@/features/shifts/ShiftTimeFields";

function defaultTime(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

type Props = {
  /** Il giorno da cui partire, se si arriva dall'agenda con una data scelta. */
  initialDate?: Date;
};

/**
 * Assegna un turno a uno o più membri dell'organico.
 *
 * ⚠️ **La sede è un campo del form, non un contesto.** È il perno del
 * riposizionamento del 14/09/2026: non si "entra" in una sede per creare i suoi
 * turni — si crea un turno e si dice dove. Il form la possiede (`useLastVenue`,
 * che ricorda l'ultima usata), e da lì discendono organico e mansioni
 * selezionabili: `useVenueStaff`/`useVenueRoles` filtrano già per sede, e non
 * hanno avuto bisogno di cambiare di una riga.
 */
export function StaffShiftForm({ initialDate }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { venueId, choose } = useLastVenue();
  const staffQuery = useVenueStaff(venueId);
  // Solo staff confermato: gli inviti ancora da accettare non sono assegnabili.
  const staff = (staffQuery.data ?? []).filter(
    (m) => m.link_status === "active"
  );
  const rolesQuery = useVenueRoles(venueId);
  const roles = rolesQuery.data ?? [];
  const create = useCreateInternalShift();

  const [date, setDate] = useState(() => initialDate ?? new Date());
  const [start, setStart] = useState(defaultTime(18));
  const [end, setEnd] = useState(defaultTime(23));
  // Chi è selezionato **e** in che ruolo: la chiave è la persona, il valore il
  // ruolo che ricopre in questo turno (null = non ancora scelto).
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [requireConfirmation, setRequireConfirmation] = useState(false);

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

  /**
   * Cambiare sede azzera persone e fabbisogni.
   *
   * Non è pulizia estetica: le chiavi di `selected` sono `staff_members.id`
   * della sede precedente e quelle di `targets` sono `venue_roles.id` della
   * sede precedente. Portarle su un turno di un'altra sede produce
   * assegnazioni incoerenti che **il database accetta** — nessuna FK lega
   * `shift_assignments.staff_member_id` alla sede del turno — e che poi nessuna
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
    choose(id);
    if (hadSelection) {
      toast.show("Persone e fabbisogni azzerati: erano di un'altra sede.");
    }
  }

  function onSubmit() {
    if (!venueId) {
      toast.show("Configura prima la tua sede.", "error");
      return;
    }
    if (selectedIds.length === 0) {
      toast.show("Seleziona almeno una persona.", "error");
      return;
    }
    if (!isValidShiftRange(toTimeString(start), toTimeString(end))) {
      toast.show(SHIFT_RANGE_ERROR, "error");
      return;
    }
    const dateStr = toDateString(date);
    const roleTargets = roles
      .map((role) => ({ role_id: role.id, count: targets[role.id] ?? 0 }))
      .filter((t) => t.count > 0);
    create.mutate(
      {
        venue_id: venueId,
        // La fascia oraria, non la data: la data è già una colonna del turno,
        // e ripeterla nel titolo riempiva la riga più in vista di ogni card
        // con l'informazione che la riga sotto dava di nuovo.
        title: shiftSlotLabel(toTimeString(start)),
        date: dateStr,
        start_time: toTimeString(start),
        end_time: toTimeString(end),
        description: note.trim() || null,
        require_confirmation: requireConfirmation,
        staff: selectedIds.map((id) => ({
          staff_member_id: id,
          role_id: selected[id],
        })),
        roleTargets,
      },
      {
        onSuccess: () => {
          toast.show("Turno assegnato allo staff");
          router.back();
        },
        onError: () =>
          toast.show("Impossibile creare il turno. Riprova.", "error"),
      }
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="p-6 gap-7"
        keyboardShouldPersistTaps="handled"
      >
        {/* Primo campo: tutto il resto del form dipende da questa risposta. */}
        <VenuePicker value={venueId} onChange={chooseVenue} />

        <View className="gap-3">
          <Mono>Giorno</Mono>
          <DayPicker value={date} onChange={setDate} />
        </View>

        <ShiftTimeFields
          date={date}
          start={start}
          end={end}
          onStartChange={setStart}
          onEndChange={setEnd}
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
          shiftTimes={{
            date: toDateString(date),
            start_time: toTimeString(start),
            end_time: toTimeString(end),
          }}
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
              ? "Assegnazione…"
              : selectedIds.length > 1
                ? `Assegna a ${selectedIds.length} persone`
                : "Assegna turno"
          }
          disabled={create.isPending || selectedIds.length === 0}
          onPress={onSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
