import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { userErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { deleteAvatarByUrl, uploadAvatar } from "@/features/account/api";
import { useSaveVenue, useUpdateVenueLogo } from "@/features/venues/hooks";
import { venueSchema, type VenueForm } from "@/features/venues/schema";
import type { Venue } from "@/features/venues/api";
import { AVATAR_ACCEPT, prepareAvatar } from "../lib/avatarFile";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Input, Textarea } from "../ui/primitives";

/**
 * Logo + modulo di una sede, in creazione o in modifica.
 *
 * Estratto da `pages/Sede.tsx` quando un account ha smesso di avere un solo
 * sede: ora lo usano `/sede` (la sede attiva) e `/sede/nuovo`.
 */
export function VenueFormCard({
  venue,
  onSaved,
  onCancel,
}: {
  /** `null` = creazione. */
  venue: Venue | null;
  /** Dopo il salvataggio. In creazione si conosce solo l'id della sede nuova. */
  onSaved?: (venue: { id: string }) => void;
  /** Aperto da una lettura (`VenueCard`): «Annulla» ci torna senza salvare. */
  onCancel?: () => void;
}) {
  const toast = useToast();
  const { session } = useAuth();
  const userId = session!.user.id;
  const { workspaceId } = useOwnerVenues();
  const save = useSaveVenue(workspaceId ?? "");
  const saveLogo = useUpdateVenueLogo();
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Stesso ordine della foto profilo in Impostazioni: prima la sede punta al
   * file nuovo, poi si cancella il vecchio. Al contrario, un errore a metà
   * lascerebbe la sede a puntare a un file che non c'è più.
   *
   * Il file va nella cartella dell'**utente** e non della sede: la policy del
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
      {/* Il logo si carica solo su una sede già creata: prima non c'è una riga
          su cui scriverlo. Sta fuori dal form perché si salva da sé — passarlo
          dal modulo avrebbe voluto dire o salvare campi a metà, o perdere la
          foto uscendo senza salvare. */}
      {venue ? (
        <Card className={cn("mb-4 max-w-2xl", onCancel && "border-gold/40")}>
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

      <Card className={cn("max-w-2xl", onCancel && "border-gold/40")}>
        <form
          onSubmit={handleSubmit((values) =>
            save.mutate(
              { input: values, venueId: venue?.id },
              { onSuccess: (saved) => onSaved?.(saved) }
            )
          )}
          className="flex flex-col gap-4"
        >
          <Field label="Nome della sede" error={errors.name?.message}>
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
            label="Tipo di sede"
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

          <div className="flex gap-2">
            {onCancel ? (
              <Button
                type="button"
                disabled={save.isPending}
                onClick={onCancel}
              >
                Annulla
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="gold"
              disabled={save.isPending || (!!venue && !isDirty)}
            >
              {save.isPending
                ? "Salvataggio…"
                : venue
                  ? "Salva modifiche"
                  : "Crea sede"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
