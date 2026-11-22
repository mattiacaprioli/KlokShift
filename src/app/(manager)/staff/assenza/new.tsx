import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { AbsenceFormView } from "@/features/absences/AbsenceFormView";
import { useRecordAbsence } from "@/features/absences/hooks";
import { recordAbsenceOptions } from "@/features/absences/recordFor";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";

/**
 * Registrare un'assenza per conto di una persona del team: la malattia
 * comunicata al telefono, le ferie concordate a voce, o chi l'app non ce l'ha.
 * Nasce già approvata, senza card in chat.
 *
 * Dalla scheda della persona arriva `memberId`; dalla pagina Assenze no, e la
 * persona si sceglie qui («Per chi», `recordAbsenceOptions`): è anche dove il
 * titolare registra le proprie ferie.
 */
export default function RecordStaffAbsenceScreen() {
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const { session } = useAuth();
  const { workspaceId, isOwner, can } = useOwnerVenues();
  const peopleQuery = useOwnerPeople(memberId ? undefined : workspaceId);
  const myId = session?.user.id ?? "";
  const options = useMemo(
    () =>
      recordAbsenceOptions(peopleQuery.data ?? [], {
        myId,
        isOwner,
        canStaffOn: (venueId) => can(venueId, "can_manage_staff"),
      }),
    [peopleQuery.data, myId, isOwner, can]
  );
  const [picked, setPicked] = useState<string | null>(null);
  const target = memberId ?? picked;
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const record = useRecordAbsence();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6">
        <ScreenHeader eyebrow="Assenze" title="Registra assenza" />
      </View>
      <AbsenceFormView
        recording
        people={
          memberId
            ? undefined
            : {
                options,
                value: picked,
                onChange: setPicked,
                loading: peopleQuery.isPending,
              }
        }
        submitLabel="Registra"
        pending={record.isPending}
        onSubmit={({ workspaceId: _workspaceId, ...input }) => {
          if (!target) return;
          record.mutate(
            { memberId: target, ...input },
            {
              onSuccess: () => {
                toast.show("Assenza registrata");
                router.back();
              },
              onError: (e) =>
                toast.show(
                  userErrorMessage(e, "Salvataggio non riuscito. Riprova."),
                  "error"
                ),
            }
          );
        }}
      />
    </View>
  );
}
