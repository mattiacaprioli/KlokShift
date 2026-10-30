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
import { SupportLine } from "../ui/SupportLine";

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
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
          <h1 className="font-serif text-2xl text-t1">
            {firstName ? `Ciao ${firstName}, i tuoi turni sono nell'app` : "I tuoi turni sono nell'app"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-t2">
            Questa è la dashboard per chi gestisce un&apos;azienda. Turni, ore e
            messaggi li trovi nell&apos;app KlokShift sul telefono, con lo stesso account.
          </p>
          <div className="mt-6 rounded-2xl border border-border-2 bg-bg-1 p-5 text-left">
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
          </div>

          {openOwn ? (
            <OpenWorkspaceCard />
          ) : (
            <button
              type="button"
              onClick={() => setOpenOwn(true)}
              className="focus-gold mt-6 text-sm text-gold underline"
            >
              Vuoi aprire un&apos;azienda tua?
            </button>
          )}

          <div className="mt-6">
            <Button onClick={() => void signOut()}>Esci</Button>
          </div>
          <SupportLine className="mt-8" />
        </div>
      </main>
    );
  }

  // Il caso normale è chi si è appena registrato per gestire un'azienda: la
  // creazione viene prima, la nota per il dipendente capitato qui dopo.
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
        <h1 className="font-serif text-2xl text-t1">
          {invited
            ? "Hai un invito da un'azienda"
            : firstName ? `Ciao ${firstName}, iniziamo` : "Iniziamo"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-t2">
          {invited
            ? "Accetta l'invito per entrare nell'azienda che ti ha aggiunto."
            : "Per iniziare crea la tua azienda: insieme nasce anche la prima sede. Poi scegli tu quando avviare la prova di 30 giorni, senza carta."}
        </p>

        {invited ? <PendingInvites /> : <OpenWorkspaceCard />}

        <p className="mt-6 text-xs leading-5 text-t3">
          Lavori in un&apos;azienda che usa già KlokShift? Turni e messaggi li
          trovi nell&apos;app sul telefono: chiedi alla sede di aggiungerti con
          l&apos;email di questo account.
        </p>
        <Button className="mt-4" onClick={() => void signOut()}>
          Esci
        </Button>
        <SupportLine className="mt-8" />
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
 * L'appartenenza appena creata fa passare il gate e monta la dashboard.
 * Dopo il salvataggio portiamo il titolare all'ultimo passo: la prova (`/prova`).
 * Il modulo è già aperto: è il motivo per cui quasi tutti arrivano qui.
 */
function OpenWorkspaceCard() {
  const navigate = useNavigate();
  const create = useCreateFirstVenue();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || create.isPending) return;
    setError(null);
    try {
      await create.mutateAsync({
        name: trimmed,
        city: null,
        address: null,
        cuisine_type: null,
        description: null,
      });
      // L’invalidazione del contesto smonta questo form. mutateAsync prosegue
      // anche dopo lo smontaggio, a differenza del callback del singolo mutate.
      navigate("/prova");
    } catch (e) {
      setError(userErrorMessage(e));
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-border-2 bg-bg-1 p-5 text-left">
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
          {create.isPending ? "Creazione…" : "Crea l'azienda"}
        </Button>
      </form>
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
