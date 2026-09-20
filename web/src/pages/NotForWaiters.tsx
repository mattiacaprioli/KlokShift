import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  useCreateFirstVenue,
  useRespondToInvite,
} from "@/features/workspace/hooks";
import { Button, Field, Input } from "../ui/primitives";

/**
 * Il muro davanti a chi non gestisce (ancora) nessuna azienda.
 *
 * Non è più solo una spiegazione. Dal modello a un solo asse «chi gestisce» non
 * è un ruolo sul profilo ma un'appartenenza con `authority`, e la registrazione
 * non ne crea nessuna: chi si iscriveva dalla dashboard con l'intenzione di
 * aprire la sua sede finiva qui e non aveva **nessuna** strada per proseguire —
 * la porta «apri la tua azienda» esisteva solo nell'app. Ora sta anche qui, ed è
 * la stessa (`createFirstVenue`).
 *
 * Tre situazioni, tre risposte:
 * - chi ha un invito in sospeso deve **accettare**, non aprire un'azienda sua
 *   (aprirne una seconda per sbaglio è il danno vero, perché poi i turni finiscono
 *   nell'azienda sbagliata): l'invito si mostra per primo;
 * - chi vuole gestire una sede la apre da qui;
 * - il professionista capitato sul link pubblico legge perché non c'è niente per
 *   lui, invece di essere rimbalzato al login.
 */
export function NotForWaitersPage() {
  const { profile, signOut } = useAuth();
  const { pendingInvites } = useOwnerVenues();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
        <h1 className="font-serif text-2xl text-t1">
          Questa dashboard è per le sedi
        </h1>
        <p className="mt-3 text-sm leading-6 text-t2">
          Ciao {profile?.full_name ?? ""}, il tuo account non gestisce ancora
          nessuna azienda. Se lavori come professionista, turni e messaggi li
          trovi nell&apos;app KlokShift sul telefono: è lì che funzionano
          meglio.
        </p>

        {pendingInvites.length > 0 ? (
          <PendingInvites />
        ) : (
          <OpenWorkspaceCard />
        )}

        <Button className="mt-6" onClick={() => void signOut()}>
          Esci
        </Button>
      </div>
    </main>
  );
}

/**
 * «Apri la tua azienda», gemella di `OpenWorkspaceSection` sull'app.
 *
 * Un campo solo: il nome vale per l'azienda **e** per la prima sede. Nella
 * stragrande maggioranza dei casi sono la stessa cosa, e chiedere due nomi a chi
 * ne ha uno solo è il modo più veloce per far abbandonare il modulo.
 *
 * Non serve navigare dopo: l'appartenenza appena creata fa passare il gate e
 * `<App />` monta la dashboard da sé.
 */
function OpenWorkspaceCard() {
  const create = useCreateFirstVenue();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  function submit() {
    if (!trimmed || create.isPending) return;
    setError(null);
    create.mutate(
      {
        name: trimmed,
        city: null,
        address: null,
        cuisine_type: null,
        description: null,
      },
      { onError: (e) => setError(userErrorMessage(e)) }
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border-2 bg-bg-1 p-5 text-left">
      <p className="text-sm font-semibold text-t1">Gestisci una sede?</p>
      <p className="mt-1 text-xs leading-5 text-t3">
        Apri qui la tua azienda: da quel momento questa dashboard è tua, con
        organico, turni e conteggio delle ore.
      </p>

      {open ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field
            label="Come si chiama"
            hint="Diventa il nome della tua azienda e della prima sede. Puoi cambiarli dopo, e aggiungere altre sedi quando vuoi."
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trattoria da Mario"
              autoFocus
            />
          </Field>
          {error ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="gold"
            disabled={create.isPending || !trimmed}
          >
            {create.isPending ? "Apertura…" : "Apri"}
          </Button>
        </form>
      ) : (
        <Button className="mt-4 w-full" onClick={() => setOpen(true)}>
          Apri la tua azienda
        </Button>
      )}
    </div>
  );
}

/**
 * Gli inviti da accettare. Capita a chi aveva già un account quando l'azienda
 * l'ha scritto sulla sua scheda: l'aggancio automatico lo collega, ma
 * l'appartenenza resta `invited` finché non è lui a dire di sì — e quel sì, fino
 * a oggi, si poteva dare solo dal telefono.
 */
function PendingInvites() {
  const { pendingInvites } = useOwnerVenues();
  const respond = useRespondToInvite();
  const [error, setError] = useState<string | null>(null);

  function answer(memberId: string, accept: boolean) {
    if (respond.isPending) return;
    setError(null);
    respond.mutate(
      { memberId, accept },
      { onError: (e) => setError(userErrorMessage(e)) }
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {pendingInvites.map((invite) => (
        <div
          key={invite.member_id}
          className="rounded-2xl border border-border-2 bg-bg-1 p-5 text-left"
        >
          <p className="text-sm font-semibold text-t1">
            {invite.workspace_name}
          </p>
          <p className="mt-1 text-xs leading-5 text-t3">
            {invite.authority === "none"
              ? "Ti ha invitato nel suo organico."
              : "Ti ha invitato a collaborare alla gestione."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="gold"
              className="flex-1"
              disabled={respond.isPending}
              onClick={() => answer(invite.member_id, true)}
            >
              {respond.isPending ? "Attendere…" : "Accetta"}
            </Button>
            <Button
              className="flex-1"
              disabled={respond.isPending}
              onClick={() => answer(invite.member_id, false)}
            >
              Rifiuta
            </Button>
          </div>
        </div>
      ))}
      {error ? (
        <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
