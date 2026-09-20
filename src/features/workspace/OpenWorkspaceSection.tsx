import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Pressable, Text, View } from "@/tw";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";
import { useViewMode } from "@/features/team/ViewMode";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useCreateFirstVenue } from "./hooks";

/**
 * «Apri la tua azienda», dal lato professionista.
 *
 * Nel modello nuovo un account non ha un ruolo: ha delle appartenenze. Chi
 * lavora per qualcun altro può benissimo aprire un proprio posto — capita
 * davvero, ed è il senso del poter stare in più aziende con cappelli diversi.
 * Il database lo permette già (`create_workspace` è aperta a chiunque sia
 * autenticato): mancava la porta nell'app, e senza quella chi si era registrato
 * come professionista non aveva nessun modo di arrivarci.
 *
 * Compare solo a chi non gestisce ancora niente: chi ha già un'azienda le sedi
 * le aggiunge da lì, dove c'è il modulo completo e il controllo sul piano.
 *
 * Un campo solo. Il nome vale per l'azienda **e** per la prima sede — nella
 * stragrande maggioranza dei casi sono la stessa cosa («Trattoria da Mario»), e
 * chiedere due nomi a chi ne ha uno solo è il modo più veloce per far
 * abbandonare il modulo. Chi ne aprirà una seconda troverà i due livelli
 * distinti, già con un esempio davanti.
 */
export function OpenWorkspaceSection() {
  const toast = useToast();
  const { canManage } = useOwnerVenues();
  const { setMode } = useViewMode();
  const create = useCreateFirstVenue();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (canManage) return null;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, city: null, address: null, cuisine_type: null, description: null },
      {
        onSuccess: () => {
          // La vista passa alla gestione da sé: il navigatore monta `(manager)`
          // appena l'appartenenza esiste. `setMode` la rende anche quella
          // ricordata, così il prossimo avvio parte di lì.
          setMode("manager");
          toast.show(`${trimmed} è aperta: aggiungi il tuo organico`);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <View className="gap-2">
      <SectionHeader title="La tua azienda" />
      <Card className="gap-3 p-4">
        {open ? (
          <>
            <Input
              label="Come si chiama"
              value={name}
              onChangeText={setName}
              placeholder="Trattoria da Mario"
              autoFocus
            />
            <Text className="text-[12px] leading-4 text-t4">
              Diventa il nome della tua azienda e della prima sede. Puoi
              cambiarli dopo, e aggiungere altre sedi quando vuoi.
            </Text>
            <GoldButton
              label={create.isPending ? "Apertura…" : "Apri"}
              disabled={create.isPending || !name.trim()}
              onPress={submit}
            />
          </>
        ) : (
          <Pressable onPress={() => setOpen(true)} className="gap-1">
            <Text className="text-[15px] font-sans-semibold text-t1">
              Apri la tua azienda
            </Text>
            <Text className="text-[13px] leading-4 text-t3">
              Organizza i turni del tuo posto e tieni l&apos;organico. Il tuo
              profilo da professionista resta com&apos;è: potrai passare da una
              parte all&apos;altra quando vuoi.
            </Text>
          </Pressable>
        )}
      </Card>
    </View>
  );
}
