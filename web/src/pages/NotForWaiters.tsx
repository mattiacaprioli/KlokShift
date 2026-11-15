import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  useCreateFirstVenue,
  useRespondToInvite,
} from "@/features/workspace/hooks";
import { signupIntent } from "@/features/team/viewModeLogic";
import { collaboratorInviteText } from "@/features/team/collaboratorSummary";
import { Button, Field, Input } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { LegalCheckbox } from "../legal/LegalCheckbox";

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
 * - il dipendente capitato sul link pubblico legge perché non c'è niente per
 *   lui, invece di essere rimbalzato al login.
 */
export function NotForWaitersPage() {
  const { session, profile, signOut } = useAuth();
  const { pendingInvites } = useOwnerVenues();
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const invited = pendingInvites.length > 0;
  // Registrato dall'app come dipendente: qui non c'è niente per lui, e il
  // modulo «crea l'azienda» in primo piano era un invito ad aprirne una per
  // sbaglio. Prima gli si dice dove sono i suoi turni; l'azienda resta a un tocco.
  const worker = !invited && signupIntent(session?.user.user_metadata) === "waiter";
  const [openOwn, setOpenOwn] = useState(false);

  if (worker) {
    return (
      <AuthShell
        title={firstName ? `Ciao ${firstName}, i tuoi turni sono nell'app` : "I tuoi turni sono nell'app"}
        subtitle="Questa è la dashboard per chi gestisce un'azienda. Turni, ore e messaggi li trovi nell'app KlokShift sul telefono, con lo stesso account."
      >
        <AuthPanel>
          <p className="text-sm font-semibold text-t1">Non vedi ancora la tua sede?</p>
          <p className="mt-1 text-sm leading-6 text-t2">
            Chiedi a chi organizza i turni di aggiungerti con questa email:
          </p>
          <p className="mt-3 select-all rounded-xl bg-bg-2 px-3 py-2 text-center text-sm font-semibold text-t1">
            {session?.user.email}
          </p>
          <p className="mt-3 text-xs leading-5 text-t3">
            Appena ti aggiunge trovi la sede e i tuoi turni nell&apos;app: non c&apos;è
            niente da accettare.
          </p>
        </AuthPanel>

        {openOwn ? (
          <div className="mt-6">
            <OpenWorkspaceCard />
          </div>
        ) : (
          <p className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setOpenOwn(true)}
              className="focus-gold rounded text-sm text-gold underline"
            >
              Vuoi aprire un&apos;azienda tua?
            </button>
          </p>
        )}

        <SignOutLink onClick={() => void signOut()} />
      </AuthShell>
    );
  }

  // Il caso normale è chi si è appena registrato per gestire un'azienda: la
  // creazione viene prima, la nota per il dipendente capitato qui dopo.
  return (
    <AuthShell
      title={invited ? "Hai un invito da un'azienda" : firstName ? `Ciao ${firstName}, iniziamo` : "Iniziamo"}
      subtitle={
        invited
          ? "Accetta l'invito per entrare nell'azienda che ti ha aggiunto."
          : "Crea la tua azienda: insieme nasce la prima sede. La prova di 30 giorni, senza carta, la avvii tu quando vuoi."
      }
    >
      {invited ? <PendingInvites /> : <OpenWorkspaceCard />}

      <p className="mt-6 text-center text-xs leading-5 text-t4">
        Lavori in un&apos;azienda che usa già KlokShift? Turni e messaggi li
        trovi nell&apos;app sul telefono: chiedi alla sede di aggiungerti con
        l&apos;email di questo account.
      </p>
      <SignOutLink onClick={() => void signOut()} />
    </AuthShell>
  );
}

/** «Esci» discreto: qui la strada è creare l'azienda, non andarsene. */
function SignOutLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="mt-4 text-center">
      <button type="button" onClick={onClick} className="focus-gold rounded text-sm text-t3 underline hover:text-t1">
        Esci
      </button>
    </p>
  );
}

/**
 * «Apri la tua azienda», gemella di `OpenWorkspaceSection` sull'app.
 *
 * Un campo solo: il nome vale per l'azienda **e** per la prima sede. Nella
 * stragrande maggioranza dei casi sono la stessa cosa, e chiedere due nomi a chi
 * ne ha uno solo è il modo più veloce per far abbandonare il modulo.
 *
 * L'appartenenza appena creata fa passare il gate e monta la dashboard.
 * Dopo il salvataggio portiamo il titolare all'ultimo passo: la prova (`/prova`).
 * Il modulo è già aperto: è il motivo per cui quasi tutti arrivano qui.
 */
function OpenWorkspaceCard() {
  const navigate = useNavigate();
  const create = useCreateFirstVenue();
  const [name, setName] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || !acceptedLegal || create.isPending) return;
    setError(null);
    try {
      await create.mutateAsync({
        name: trimmed,
        city: null,
        address: null,
        cuisine_type: null,
        description: null,
        acceptedLegal,
      });
      // L’invalidazione del contesto smonta questo form. mutateAsync prosegue
      // anche dopo lo smontaggio, a differenza del callback del singolo mutate.
      navigate("/prova");
    } catch (e) {
      setError(userErrorMessage(e));
    }
  }

  return (
    <AuthPanel>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Come si chiama la tua azienda?"
          hint="Lo usiamo anche per la prima sede. Puoi cambiare entrambi i nomi quando vuoi."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bottega Rossi"
            autoFocus
          />
        </Field>
        <LegalCheckbox checked={acceptedLegal} onChange={setAcceptedLegal} />
        {error ? (
          <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="gold"
          disabled={create.isPending || !trimmed || !acceptedLegal}
        >
          {create.isPending ? "Creazione…" : "Crea l'azienda"}
        </Button>
      </form>
    </AuthPanel>
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
    <div className="flex flex-col gap-3">
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
              ? "Ti ha invitato nel suo team."
              : collaboratorInviteText(invite)}
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
