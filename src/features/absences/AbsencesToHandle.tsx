import { useState } from "react";
import { Pressable, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import type { AbsenceWithPerson } from "./api";
import { useAbsencesToHandle } from "./hooks";
import { ABSENCE_KIND_LABEL, formatAbsenceRange } from "./labels";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceModal } from "./ResolveAbsenceModal";

/**
 * Il blocco «Richieste» della home: ferie e permessi da decidere, e le malattie
 * comunicate negli ultimi giorni (non si decidono, ma servono per trovare chi
 * copre). Sparisce quando non c'è niente.
 *
 * `enabled` segue il permesso Organico: senza, la RLS restituirebbe zero righe
 * e la query sarebbe solo una richiesta sprecata.
 *
 * ⚠️ Gemello web in `web/src/absences/AbsencesToHandle.tsx`.
 */
export function AbsencesToHandle({
  enabled,
  onOpenPerson,
}: {
  enabled: boolean;
  onOpenPerson: (personId: string) => void;
}) {
  const query = useAbsencesToHandle(enabled);
  const rows = query.data ?? [];
  const [resolving, setResolving] = useState<AbsenceWithPerson | null>(null);

  if (!enabled || rows.length === 0) return null;

  const pendingCount = rows.filter((a) => a.status === "pending").length;

  return (
    <View className="gap-3">
      <View>
        <Mono gold>
          {pendingCount > 0 ? `Da decidere · ${pendingCount}` : "Assenze"}
        </Mono>
        <Display className="mt-0.5 text-2xl">Richieste</Display>
      </View>
      <View className="gap-2.5">
        {rows.map((a) => {
          const pending = a.status === "pending";
          const name = a.person?.full_name ?? "Persona";
          return (
            <View
              key={a.id}
              className="rounded-3xl border border-border-2 bg-bg-card px-4 py-3.5"
            >
              <Pressable
                onPress={() =>
                  pending ? setResolving(a) : onOpenPerson(a.member_id)
                }
                className="flex-row items-center gap-3"
              >
                <View className="flex-1">
                  <Text className="text-base font-sans-bold text-t1">{name}</Text>
                  <Text className="mt-0.5 text-xs text-t3">
                    {ABSENCE_KIND_LABEL[a.kind]} · {formatAbsenceRange(a)}
                  </Text>
                </View>
                <Pill
                  label={pending ? "Da decidere" : "Comunicata"}
                  variant={pending ? "pending" : "neutral"}
                />
              </Pressable>
              {/* Malattia: i turni dei prossimi giorni da liberare. */}
              {pending ? null : <AbsenceConflictsBlock absence={a} />}
            </View>
          );
        })}
      </View>

      {resolving ? (
        <ResolveAbsenceModal
          absence={resolving}
          personName={resolving.person?.full_name}
          onClose={() => setResolving(null)}
        />
      ) : null}
    </View>
  );
}
