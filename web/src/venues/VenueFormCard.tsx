import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { userErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { deleteAvatarByUrl, uploadAvatar } from "@/features/account/api";
import { useSaveVenue, useUpdateVenueLogo } from "@/features/venues/hooks";
import { venueSchema, type VenueForm } from "@/features/venues/schema";
import type { Venue } from "@/features/venues/api";
import { AVATAR_ACCEPT, prepareAvatar } from "../lib/avatarFile";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { Button, Card, Field, Input, Textarea } from "../ui/primitives";

/**
 * Logo + modulo di un locale, in creazione o in modifica.
 *
 * Estratto da `pages/Locale.tsx` quando un account ha smesso di avere un solo
 * locale: ora lo usano `/locale` (la sede attiva) e `/locale/nuovo`.
 */
export function VenueFormCard({
  venue,
  onSaved,
}: {
  /** `null` = creazione. */
  venue: Venue | null;
  onSaved?: (venue: Venue) => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const userId = session!.user.id;
  const save = useSaveVenue(userId);
  const saveLogo = useUpdateVenueLogo(userId);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Stesso ordine della foto profilo in Impostazioni: prima il locale punta al
   * file nuovo, poi si cancella il vecchio. Al contrario, un errore a metà
   * lascerebbe il locale a puntare a un file che non c'è più.
   *
   * Il file va nella cartella dell'**utente** e non del locale: la policy del
   * bucket `avatars` accetta scritture solo in `<auth.uid()>/…`.
   */
  async function onPickLogo(file: File | undefined) {
    if (!file || !venue) return;
    const previous = venue.logo_url ?? null;
    setLogoBusy(true);
    try {
      const blob = await prepareAvatar(file);
      const url = await uploadAvatar(userId, blob);
      await saveLogo.mutateAsync({ venueId: venue.id, logoUrl: url });
      await deleteAvatarByUrl(previous);
      toast.show("Logo aggiornato");
    } catch (e) {
      toast.show(userErrorMessage(e, "Caricamento non riuscito"), "error");
    } finally {
      setLogoBusy(false);
      // Così riselezionare lo stesso file rilancia l'evento.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    const previous = venue?.logo_url ?? null;
    if (!venue || !previous) return;
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

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<VenueForm>({
    resolver: zodResolver(venueSchema),
    defaultValues: {
      name: venue?.name ?? "",
      city: venue?.city ?? "",
      address: venue?.address ?? "",
      cuisine_type: venue?.cuisine_type ?? "",
      description: venue?.description ?? "",
    },
  });

  return (
    <>
      {/* Il logo si carica solo su un locale già creato: prima non c'è una riga
          su cui scriverlo. Sta fuori dal form perché si salva da sé — passarlo
          dal modulo avrebbe voluto dire o salvare campi a metà, o perdere la
          foto uscendo senza salvare. */}
      {venue ? (
        <Card className="mb-4 max-w-2xl">
          <div className="flex items-center gap-4">
            <Avatar url={venue.logo_url} name={venue.name} size={72} />
            <div className="flex min-w-0 flex-col items-start gap-2">
              <p className="text-xs text-t3">
                Il logo compare ai professionisti sui turni di questa sede.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => fileRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy
                    ? "Caricamento…"
                    : venue.logo_url
                      ? "Cambia logo"
                      : "Carica un logo"}
                </Button>
                {venue.logo_url ? (
                  <Button
                    variant="danger"
                    disabled={logoBusy}
                    onClick={() => void removeLogo()}
                  >
                    Rimuovi
                  </Button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={AVATAR_ACCEPT}
                hidden
                onChange={(e) => void onPickLogo(e.target.files?.[0])}
              />
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="max-w-2xl">
        <form
          onSubmit={handleSubmit((values) =>
            save.mutate(
              { input: values, venueId: venue?.id },
              { onSuccess: (saved) => onSaved?.(saved) }
            )
          )}
          className="flex flex-col gap-4"
        >
          <Field label="Nome del locale" error={errors.name?.message}>
            <Input {...register("name")} placeholder="Trattoria da Mario" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Città" error={errors.city?.message}>
              <Input {...register("city")} />
            </Field>
            <Field label="Indirizzo" error={errors.address?.message}>
              <Input {...register("address")} />
            </Field>
          </div>

          <Field
            label="Tipo di locale"
            hint="Ristorante, hotel, catering, pub, discoteca…"
            error={errors.cuisine_type?.message}
          >
            <Input {...register("cuisine_type")} />
          </Field>

          <Field label="Descrizione" error={errors.description?.message}>
            <Textarea {...register("description")} />
          </Field>

          {save.isError ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {userErrorMessage(save.error)}
            </p>
          ) : null}
          {save.isSuccess && !isDirty ? (
            <p className="text-xs text-success">Salvato.</p>
          ) : null}

          <div>
            <Button type="submit" variant="gold" disabled={save.isPending}>
              {save.isPending
                ? "Salvataggio…"
                : venue
                  ? "Salva modifiche"
                  : "Crea locale"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
