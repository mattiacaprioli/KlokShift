import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboardAvoidingView, ScrollView as RNScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@/tw";
import { ControlledInput } from "@/components/form/ControlledInput";
import { AvatarPickerField } from "@/components/ui/AvatarPickerField";
import { GoldButton } from "@/components/ui/GoldButton";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { TabPanel, TabPills } from "@/components/ui/TabPills";
import { deleteAvatarByUrl, uploadAvatar } from "@/features/account/api";
import { pickAvatar } from "@/features/account/avatarPicker";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useCreateFirstVenue } from "@/features/workspace/hooks";
import { useToast } from "@/providers/Toast";
import { useSaveVenue, useUpdateVenueLogo } from "./hooks";
import { venueSchema, type VenueForm } from "./schema";
import type { Venue } from "./api";

/**
 * Il modulo di una sede, in creazione o in modifica.
 *
 * Estratto da `(manager)/venue.tsx` quando un account ha smesso di avere un solo
 * sede: ora lo usano `venue/new` e `venue/[id]`, come `ShiftFormView` fa per
 * `shift/new` e `shift/edit/[id]`.
 */
export type VenueTab = { id: string; label: string; content: ReactNode };

export function VenueFormView({
  venue,
  workspaceId,
  firstWorkspace = false,
  eyebrow = "Sede",
  title,
  intro,
  onSaved,
  footer,
  tabs: extraTabs = [],
}: {
  /** `null` = creazione. */
  venue: Venue | null;
  /** L'azienda a cui appartiene la sede. */
  workspaceId: string | undefined;
  /**
   * Chi la crea non ha ancora un'azienda: la prima sede la apre insieme
   * all'azienda (`useCreateFirstVenue`). Va detto in modo esplicito
   * (`venueNewMode`): `workspaceId` assente può anche voler dire «contesto non
   * caricato», e lì creare un'azienda ne farebbe nascere una seconda.
   */
  firstWorkspace?: boolean;
  eyebrow?: string;
  title?: string;
  intro?: string;
  onSaved: (venueId: string) => void;
  /** Sotto il pulsante: "Chiudi sede" sulla modifica, niente in creazione. */
  footer?: ReactNode;
  /**
   * Le altre sezioni della sede (chiusure, timbrature…), ciascuna in un tab
   * dopo «Dati sede». Senza, il modulo è da solo e i tab non si vedono: è la
   * creazione, dove c'è solo il nome da scrivere.
   */
  tabs?: VenueTab[];
}) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const save = useSaveVenue(workspaceId ?? "");
  const createFirst = useCreateFirstVenue();
  const saveLogo = useUpdateVenueLogo();
  const saving = save.isPending || createFirst.isPending;
  const [logoBusy, setLogoBusy] = useState(false);
  const [selectedTab, setSelectedTab] = useState("dati");
  const scrollRef = useRef<RNScrollView>(null);
  const tabs =
    extraTabs.length > 0 ? [{ id: "dati", label: "Dati sede" }, ...extraTabs] : [];
  // Un tab può sparire a scheda aperta (cambia un permesso): si torna ai dati.
  const tab = tabs.some((t) => t.id === selectedTab) ? selectedTab : "dati";

  function onTabChange(id: string) {
    setSelectedTab(id);
    // Ogni sezione riparte dall'alto.
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  const { control, handleSubmit, reset } = useForm<VenueForm>({
    resolver: zodResolver(venueSchema),
    defaultValues: {
      name: "",
      city: "",
      address: "",
      cuisine_type: "",
      description: "",
    },
  });

  useEffect(() => {
    if (venue) {
      reset({
        name: venue.name,
        city: venue.city ?? "",
        address: venue.address ?? "",
        cuisine_type: venue.cuisine_type ?? "",
        description: venue.description ?? "",
      });
    }
  }, [venue, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      city: values.city || null,
      address: values.address || null,
      cuisine_type: values.cuisine_type || null,
      description: values.description || null,
    };
    try {
      let venueId: string;
      if (!venue && firstWorkspace) {
        venueId = (await createFirst.mutateAsync(input)).venueId;
      } else if (!workspaceId) {
        // Azienda non letta: nessuna chiamata, e mai un'azienda «di ripiego».
        toast.show("Non riusciamo a leggere la tua azienda. Riprova.", "error");
        return;
      } else {
        venueId = (await save.mutateAsync({ input, venueId: venue?.id })).id;
      }
      toast.show(venue ? "Sede salvata" : "Sede creata");
      onSaved(venueId);
    } catch (e) {
      toast.show(userErrorMessage(e, "Impossibile salvare. Riprova."), "error");
    }
  });

  /**
   * Stesso ordine della foto profilo: prima la sede punta al file nuovo, poi
   * si cancella il vecchio. Al contrario, un errore a metà lascerebbe la sede
   * a puntare a un file che non c'è più.
   *
   * Il file va sotto la cartella dell'**utente** e non della sede: la policy del
   * bucket `avatars` accetta scritture solo in `<auth.uid()>/…`, e il titolare è
   * comunque l'unico che può caricarlo.
   */
  async function onLogo() {
    if (logoBusy) return;
    if (!venue || !session) {
      toast.show("Salva prima il nome della sede.", "error");
      return;
    }
    const previous = venue.logo_url ?? null;
    try {
      const picked = await pickAvatar();
      if (!picked) return; // annullato
      setLogoBusy(true);
      const url = await uploadAvatar(session.user.id, picked.bytes, {
        contentType: picked.contentType,
      });
      await saveLogo.mutateAsync({ venueId: venue.id, logoUrl: url });
      await deleteAvatarByUrl(previous);
      toast.show("Logo aggiornato");
    } catch (e) {
      toast.show(userErrorMessage(e, "Caricamento non riuscito"), "error");
    } finally {
      setLogoBusy(false);
    }
  }

  async function onRemoveLogo() {
    const previous = venue?.logo_url ?? null;
    if (!venue || !previous || logoBusy) return;
    setLogoBusy(true);
    try {
      await saveLogo.mutateAsync({ venueId: venue.id, logoUrl: null });
      await deleteAvatarByUrl(previous);
      toast.show("Logo rimosso");
    } catch (e) {
      toast.show(userErrorMessage(e, "Operazione non riuscita"), "error");
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0">
        {/* Header e tab restano fermi: a scorrere è solo la sezione. */}
        <View
          className={cn(
            "shrink-0 gap-4",
            tabs.length > 0 ? "border-b border-border pb-3" : "pb-4"
          )}
          style={{ paddingTop: insets.top + 8 }}
        >
          <View className="px-5">
            <ScreenHeader
              eyebrow={eyebrow}
              title={title ?? (venue ? venue.name : "Nuova sede")}
            />
          </View>
          {tabs.length > 0 ? (
            <TabPills tabs={tabs} active={tab} onChange={onTabChange} />
          ) : null}
        </View>

        <RNScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: tabs.length > 0 ? 20 : 0,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 48,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <TabPanel active={tab === "dati"}>
            <View className="gap-4">
              {/* L'invito a scrivere solo il nome vale per chi la sta creando. */}
              {intro || !venue ? (
                <Text className="text-base text-t2">
                  {intro ??
                    "Serve solo il nome: lo vede il tuo team sui turni. Il resto puoi completarlo dopo."}
                </Text>
              ) : null}

              {/* Il logo si può caricare solo su una sede già creata: prima non c'è
                  una riga su cui scriverlo. Chi sta compilando il modulo per la prima
                  volta lo trova qui appena salva il nome. */}
              {venue ? (
                <AvatarPickerField
                  uri={venue.logo_url}
                  name={venue.name}
                  busy={logoBusy}
                  onPick={onLogo}
                  onRemove={onRemoveLogo}
                  addLabel="Aggiungi logo"
                  changeLabel="Cambia logo"
                />
              ) : null}

              <ControlledInput
                control={control}
                name="name"
                label="Nome della sede"
                placeholder="Trattoria da Mario"
              />
              <ControlledInput
                control={control}
                name="city"
                label="Città"
                placeholder="Milano"
              />
              <ControlledInput
                control={control}
                name="address"
                label="Indirizzo"
                placeholder="Via Roma 1"
              />
              <ControlledInput
                control={control}
                name="cuisine_type"
                // La colonna resta `cuisine_type` per non migrare il DB: l'etichetta
                // è neutra perché un hotel o un'agenzia eventi non ha una "cucina".
                label="Tipo di attività"
                placeholder="Negozio, hotel, ristorante, palestra…"
              />
              <ControlledInput
                control={control}
                name="description"
                label="Descrizione"
                placeholder="Racconta la tua sede"
                multiline
                numberOfLines={4}
                className="h-28"
                textAlignVertical="top"
              />

              <GoldButton
                className="mt-2"
                label={
                  saving
                    ? "Salvataggio…"
                    : venue
                      ? "Salva sede"
                      : "Crea sede"
                }
                disabled={saving}
                onPress={onSubmit}
              />

              {footer ? <View className="mt-4">{footer}</View> : null}
            </View>
          </TabPanel>

          {extraTabs.map((t) => (
            <TabPanel key={t.id} active={tab === t.id}>
              {t.content}
            </TabPanel>
          ))}
        </RNScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
