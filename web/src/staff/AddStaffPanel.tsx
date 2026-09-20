import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { useAddSelfToStaff, useAddStaff } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { RoleCheckboxes } from "./RoleCheckboxes";
import type { AddStaffResult } from "@/features/staff/api";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Input, Select } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * In quali sedi lavora. Almeno una; con una sede sola non compare, perché la
 * risposta è già nota.
 *
 * Ritorna anche `single`: l'id quando ne è selezionata **esattamente una**. I
 * ruoli vivono in `venue_roles`, che è per sede, quindi si possono chiedere solo
 * in quel caso — con due o più servirebbero due o più elenchi di caselle.
 */
function useVenueSelection() {
  const { venues, isMultiVenue } = useOwnerVenues();
  const { venueId: lastVenueId } = useLastVenue();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const value = picked ?? new Set(lastVenueId ? [lastVenueId] : []);

  function toggle(id: string) {
    setPicked(() => {
      const next = new Set(value);
      // L'ultima non si toglie: una persona senza sedi non esiste (il trigger
      // `delete_orphan_staff_person` la cancellerebbe) e il bottone resterebbe
      // disabilitato senza dire perché.
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  const node = isMultiVenue ? (
    <Field label="In quali sedi">
      <div className="flex flex-wrap gap-1.5">
        {venues.map((v) => {
          const on = value.has(v.id);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => toggle(v.id)}
              aria-pressed={on}
              className={cn(
                "focus-gold rounded-full px-3 py-1.5 text-xs font-medium transition",
                on
                  ? "bg-gold text-gold-ink"
                  : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
              )}
            >
              {v.name}
            </button>
          );
        })}
      </div>
    </Field>
  ) : null;

  return {
    venueIds: [...value],
    single: value.size === 1 ? [...value][0] : undefined,
    node,
  };
}

/**
 * Aggiungi una persona all'organico.
 *
 * Dal 14/09/2026 si aggiunge **una persona**, non una sua scheda di sede: prima
 * chi, poi dove. È sparita la modalità «Dalle tue sedi» — esisteva per rimediare
 * al fatto che l'organico era della sede attiva, e riusare qualcuno significava
 * ricopiarlo qui. Ora l'organico è dell'azienda: chi c'è già è già in elenco, e
 * gli si aggiunge una sede dalla sua scheda.
 *
 * Dal 16/09/2026 sono spariti anche i due tab «Scheda manuale / Invita via
 * email»: chiedevano al titolare se quella persona avesse già KlokShift, cosa
 * che non può sapere. Scrive nome ed email, e `addStaff` decide — scheda,
 * invito in-app o email d'invito. Stessa funzione dell'app.
 *
 * Dal 17/09/2026 lo stesso pannello mette in organico **chi guarda** (`self`):
 * chi gestisce la sede spesso ci lavora, e senza una scheda le sue ore non
 * entrano in nessun conto. Cambiano due campi — il nome è il suo e non si
 * scrive, l'email non serve perché l'account si conosce già — e tutto il resto,
 * sedi, impiego e ruoli, è identico.
 */
export function AddStaffPanel({
  self = false,
  onClose,
}: {
  self?: boolean;
  onClose: () => void;
}) {
  const { workspaceId } = useOwnerVenues();
  const { profile } = useAuth();
  const add = useAddStaff();
  const addSelf = useAddSelfToStaff();
  const toast = useToast();
  const { venueIds, single, node: venuePicker } = useVenueSelection();
  const [name, setName] = useState(() =>
    self ? (profile?.full_name ?? "") : ""
  );
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");
  const [phone, setPhone] = useState("");
  const pending = add.isPending || addSelf.isPending;

  /**
   * La persona era già in organico: non è un errore, l'accordo con lei esiste.
   * Si dice di aprirla dall'elenco invece di crearne una seconda scheda che si
   * porterebbe dietro ore e documenti separati.
   */
  const [already, setAlready] = useState(false);

  function messageFor(res: AddStaffResult): string {
    if (res.kind === "app_invite") return "Richiesta inviata";
    if (res.kind === "email_invite") {
      if (res.emailSent) return "Aggiunto allo staff · invito spedito";
      return res.emailError
        ? `Aggiunto allo staff · invito non spedito: ${res.emailError}`
        : "Aggiunto allo staff · invito non spedito, riprova dalla sua scheda";
    }
    return "Aggiunto allo staff";
  }

  /**
   * Quel che viene dopo, uguale per le due modalità: il toast e la chiusura.
   *
   * ⚠️ Le mansioni non sono più un secondo passo: viaggiano dentro `add_member`,
   * che le scrive nella stessa transazione della scheda.
   */
  function finish(msg: string) {
    toast.show(single || roleIds.length === 0 ? msg : `${msg} · assegna le mansioni in ogni sede`);
    onClose();
  }

  function submit() {
    if (!workspaceId) return;
    setAlready(false);

    // Le mansioni sono **per sede**: con più sedi la stessa lista non varrebbe
    // per tutte, e si assegnano dopo dalla scheda.
    const roles = single && roleIds.length > 0 ? roleIds : undefined;

    if (self) {
      addSelf.mutate(
        {
          workspaceId,
          venueIds,
          employmentType: empType,
          phone: phone.trim() || null,
          roleIds: roles,
        },
        {
          onSuccess: () => finish("Sei in organico"),
          onError: (e) => toast.show(userErrorMessage(e), "error"),
        }
      );
      return;
    }

    add.mutate(
      {
        workspaceId,
        venueIds,
        fullName: name.trim(),
        employmentType: empType,
        phone: phone.trim() || null,
        email: email.trim() || null,
        roleIds: roles,
      },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            setAlready(true);
            return;
          }
          finish(messageFor(res));
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="mb-5">
      {/* `items-start` e non `items-end`: l'hint sotto l'email è una riga in più
          in fondo alla Field, e allineando i campi in basso alzava quel solo
          input rispetto agli altri tre. In alto le etichette sono tutte di una
          riga, quindi gli input restano sulla stessa linea. */}
      <div className="grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
        {/* Il proprio nome è quello del profilo: scriverne un altro darebbe
            due nomi alla stessa persona. */}
        <Field
          label="Nome"
          hint={self ? "Il tuo: si cambia dal profilo." : undefined}
        >
          <Input
            value={name}
            readOnly={self}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome e cognome"
            className={self ? "opacity-60" : undefined}
          />
        </Field>
        {/* Nessuna email quando ci si mette da sé: non c'è nessun invito da
            mandare e nessun account da agganciare — è già il mio. */}
        {self ? null : (
          <Field
            label="Email"
            hint="Facoltativa. Serve a collegarle il suo account."
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setAlready(false);
              }}
              placeholder="nome@esempio.it"
            />
          </Field>
        )}
        <Field label="Impiego">
          <Select
            value={empType}
            onChange={(e) =>
              setEmpType(e.target.value as Enums<"employment_type">)
            }
          >
            <option value="fisso">Fisso</option>
            <option value="a_chiamata">A chiamata</option>
          </Select>
        </Field>
        <Field label="Telefono">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      {already ? (
        <p className="mt-4 rounded-xl border border-border-2 bg-bg-1 p-3 text-sm text-t2">
          Questa persona è <b className="text-t1">già nel tuo organico</b>.
          Aprila dall&apos;elenco per aggiungerle una sede o cambiarle i ruoli:
          tiene anagrafica e documenti che ha già.
        </p>
      ) : null}

      {venuePicker ? <div className="mt-4">{venuePicker}</div> : null}

      <div className="mt-4">
        {single ? (
          <Field label="Ruoli">
            <RoleCheckboxes
              venueId={single}
              value={roleIds}
              onChange={setRoleIds}
            />
          </Field>
        ) : (
          <p className="text-xs text-t3">
            I ruoli cambiano da una sede all&apos;altra: li assegnerai dalla sua
            scheda, sede per sede.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="gold"
          disabled={!name.trim() || venueIds.length === 0 || pending}
          onClick={submit}
        >
          {pending ? "Salvataggio…" : self ? "Mettimi in organico" : "Aggiungi"}
        </Button>
        <span className="text-xs text-t4">
          {self
            ? "Da qui in poi puoi assegnarti i turni come a chiunque altro, e le tue ore entrano nel riepilogo e nell'export."
            : "Se ha già un account, gli arriva la richiesta nell'app. Altrimenti gli mandiamo un invito e, quando si registra con questa email, lo colleghiamo a questa scheda."}
        </span>
      </div>
    </Card>
  );
}
