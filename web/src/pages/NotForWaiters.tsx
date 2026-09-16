import { useAuth } from "@/lib/auth";
import { Button } from "../ui/primitives";

/**
 * Un professionista che arriva qui non ha sbagliato: il link è pubblico. Gli si
 * spiega perché non c'è niente per lui, invece di rimbalzarlo al login.
 */
export function NotForWaitersPage() {
  const { profile, signOut } = useAuth();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
        <h1 className="font-serif text-2xl text-t1">
          Questa dashboard è per le sedi
        </h1>
        <p className="mt-3 text-sm leading-6 text-t2">
          Ciao {profile?.full_name ?? ""}, il tuo account è da professionista.
          Turni, messaggi e recensioni li trovi nell&apos;app KlokShift
          sul telefono: è lì che funzionano meglio.
        </p>
        <p className="mt-2 text-xs text-t4">
          Questo strumento serve a chi gestisce una sede per programmare i turni
          e tenere i conti delle ore da computer.
        </p>
        <Button className="mt-6" onClick={() => void signOut()}>
          Esci
        </Button>
      </div>
    </main>
  );
}
