import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { userErrorMessage } from "@/lib/errors";
import { changePasswordSchema } from "@/features/auth/schema";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  useSetStaffCanChat,
  useStaffCanChat,
} from "@/features/workspace/hooks";
import { useAuth } from "@/lib/auth";
import {
  NOTIFICATION_CATEGORIES,
  prefsFromProfile,
  saveNotificationPrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/features/notifications/preferences";
import { LEGAL_URLS } from "@/features/account/legal";
import {
  deleteAvatarByUrl,
  deleteMyAccount,
  updateMyProfile,
  uploadAvatar,
} from "@/features/account/api";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  PasswordInput,
} from "../ui/primitives";
import { Avatar } from "../ui/Avatar";
import { PasswordChecklist } from "../ui/PasswordChecklist";
import { useToast } from "../ui/Toast";
import { AVATAR_ACCEPT, prepareAvatar } from "../lib/avatarFile";

export function ImpostazioniPage() {
  const { session } = useAuth();
  const { isOwner, workspaceId } = useOwnerVenues();

  return (
    <>
      <PageHeader title="Impostazioni" subtitle={session?.user.email ?? ""} />

      <div className="flex max-w-2xl flex-col gap-8">
        <AccountSection />

        <PasswordSection />

        <NotificationPrefsSection />

        {isOwner && workspaceId ? <Card><Link className="focus-gold text-gold underline" to="/piano">Piano e accesso dell’azienda</Link></Card> : null}

        {isOwner && workspaceId ? (
          <StaffChatSection workspaceId={workspaceId} />
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
            Documenti
          </h2>
          <Card className="flex flex-col gap-1 p-0">
            <LegalLink href={LEGAL_URLS.privacy} label="Informativa privacy" />
            <LegalLink
              href={LEGAL_URLS.accountDeletion}
              label="Come cancellare l'account"
            />
          </Card>
        </section>

        <DeleteAccountSection />
      </div>
    </>
  );
}

/**
 * «Chat fra colleghi», l'interruttore dell'azienda.
 *
 * Acceso di default: chi lavora insieme si parla comunque, e pretendere
 * un'azione del titolare avrebbe reso la funzione invisibile quasi ovunque.
 * Spegnerlo non cancella niente — i thread aperti restano leggibili, non se ne
 * aprono di nuovi — e non isola mai nessuno da chi gestisce: al titolare e ai
 * collaboratori si scrive sempre.
 */
function StaffChatSection({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  // Lo stato vero o niente: un interruttore «acceso» per difetto, con la
  // lettura fallita, direbbe una cosa non verificata e al primo clic la
  // scriverebbe al contrario.
  const { data: enabled, isError } = useStaffCanChat(workspaceId);
  const save = useSetStaffCanChat();

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Chat
      </h2>
      <Card className="p-0">
        <label className="flex cursor-pointer items-center gap-4 px-4 py-3 has-disabled:cursor-not-allowed">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-t1">
              Chat fra colleghi
            </span>
            <span className="mt-0.5 block text-xs text-t3">
              Chi è in organico può scriversi. A te e ai collaboratori si scrive
              comunque.
            </span>
            {isError ? (
              <span className="mt-1 block text-xs text-warning">
                Stato non disponibile: ricarica la pagina per modificarlo.
              </span>
            ) : null}
          </span>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled === true}
            disabled={enabled === undefined || save.isPending}
            onChange={(e) =>
              save.mutate(
                { workspaceId, enabled: e.target.checked },
                {
                  onSuccess: () =>
                    toast.show(
                      e.target.checked
                        ? "I colleghi possono scriversi"
                        : "Chat fra colleghi disattivata"
                    ),
                  onError: (err) =>
                    toast.show(
                      userErrorMessage(err, "Salvataggio non riuscito"),
                      "error"
                    ),
                }
              )
            }
          />
          {/* L'interruttore è solo disegno: lo stato vero è la checkbox qui
              sopra, che resta quella che legge lo screen reader. */}
          <span
            aria-hidden
            className="relative h-5 w-9 shrink-0 rounded-full bg-bg-3 transition peer-checked:bg-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg-card peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-t3 after:transition peer-checked:after:translate-x-4 peer-checked:after:bg-gold-ink"
          />
        </label>
      </Card>
    </section>
  );
}

/**
 * Nome e foto del profilo. Fino a ieri si cambiavano solo dall'app: chi gestisce
 * la sede dalla dashboard si vedeva comparire il proprio nome in chat e sui
 * turni senza avere un posto dove sistemarlo.
 *
 * La foto viene ritagliata e ridimensionata dal browser prima di partire (vedi
 * `lib/avatarFile`), e finisce nel bucket pubblico `avatars`, una cartella per
 * utente.
 */
function AccountSection() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Si apre in lettura: nome e foto si vedono in chat e sui turni di tutti, e
  // non devono cambiare per un tasto premuto per sbaglio.
  const [editing, setEditing] = useState(false);

  const userId = session!.user.id;
  const trimmed = name.trim();
  const dirty = trimmed !== (profile?.full_name ?? "").trim();

  async function saveName() {
    if (!trimmed || !dirty) return;
    setSavingName(true);
    try {
      await updateMyProfile(userId, { full_name: trimmed });
      await refreshProfile();
      setEditing(false);
      toast.show("Nome aggiornato");
    } catch (e) {
      toast.show(userErrorMessage(e, "Salvataggio non riuscito"), "error");
    } finally {
      setSavingName(false);
    }
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    const previous = profile?.avatar_url ?? null;
    setPhotoBusy(true);
    try {
      const blob = await prepareAvatar(file);
      const url = await uploadAvatar(userId, blob);
      await updateMyProfile(userId, { avatar_url: url });
      // Prima si aggiorna il profilo, poi si toglie la vecchia: al contrario,
      // un errore a metà lascerebbe il profilo che punta a un file cancellato.
      await deleteAvatarByUrl(previous);
      await refreshProfile();
      toast.show("Foto aggiornata");
    } catch (e) {
      toast.show(userErrorMessage(e, "Caricamento non riuscito"), "error");
    } finally {
      setPhotoBusy(false);
      // Così riselezionare lo stesso file rilancia l'evento.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    const previous = profile?.avatar_url ?? null;
    if (!previous) return;
    setPhotoBusy(true);
    try {
      await updateMyProfile(userId, { avatar_url: null });
      await deleteAvatarByUrl(previous);
      await refreshProfile();
      toast.show("Foto rimossa");
    } catch (e) {
      toast.show(userErrorMessage(e, "Operazione non riuscita"), "error");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Account
      </h2>
      <Card className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar
            url={profile?.avatar_url}
            name={profile?.full_name ?? session?.user.email ?? "?"}
            size={72}
          />
          <div className="flex min-w-0 flex-col items-start gap-2">
            {editing ? null : (
              <p className="truncate text-lg text-t1">
                {profile?.full_name || "Nome non indicato"}
              </p>
            )}
            <p className="truncate text-xs text-t3">{session?.user.email}</p>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => fileRef.current?.click()}
                  disabled={photoBusy}
                >
                  {photoBusy
                    ? "Caricamento…"
                    : profile?.avatar_url
                      ? "Cambia foto"
                      : "Carica una foto"}
                </Button>
                {profile?.avatar_url ? (
                  <Button
                    variant="danger"
                    disabled={photoBusy}
                    onClick={() => void removePhoto()}
                  >
                    Rimuovi
                  </Button>
                ) : null}
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_ACCEPT}
              hidden
              onChange={(e) => void onPickPhoto(e.target.files?.[0])}
            />
          </div>
        </div>

        {editing ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nome e cognome">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mario Rossi"
                className="w-64"
              />
            </Field>
            <Button
              variant="gold"
              disabled={!dirty || !trimmed || savingName}
              onClick={() => void saveName()}
            >
              {savingName ? "Salvataggio…" : "Salva"}
            </Button>
            <Button
              disabled={savingName}
              onClick={() => {
                setName(profile?.full_name ?? "");
                setEditing(false);
              }}
            >
              {/* La foto si salva appena scelta: senza un nome da buttare via
                  «Annulla» prometterebbe di annullare anche quella. */}
              {dirty ? "Annulla" : "Chiudi"}
            </Button>
            <Button className="ml-auto" onClick={() => void signOut()}>
              Esci
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setName(profile?.full_name ?? "");
                setEditing(true);
              }}
            >
              Modifica
            </Button>
            <Button className="ml-auto" onClick={() => void signOut()}>
              Esci
            </Button>
          </div>
        )}
      </Card>
      <p className="mt-2 px-1 text-xs text-t4">
        È lo stesso profilo dell&apos;app: nome e foto si vedono in chat e sui
        turni. La sede — nome, indirizzo, logo — si modifica dalla scheda
        Sede.
      </p>
    </section>
  );
}

/**
 * Cambio password da loggati. Il gemello app è
 * `src/features/auth/ChangePasswordForm.tsx`; le regole vengono da
 * `changePasswordSchema`, così le due strade non si disallineano.
 *
 * ⚠️ Non è `NuovaPassword.tsx`: là la prova d'identità è il link ricevuto per
 * email, qui la sessione da sola non basta e si chiede la password attuale.
 *
 * Se la password cambia ma gli altri dispositivi non si disconnettono,
 * `warning` resta scritto nella sezione (non come errore) finché non si riapre
 * il modulo: un toast sparirebbe da solo.
 */
function PasswordSection() {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = changePasswordSchema.safeParse({
      currentPassword: current,
      password,
      confirmPassword: confirm,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Controlla i campi.");
      return;
    }
    setError(null);
    setBusy(true);
    const res = await changePassword(current, password);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    toast.show("Password aggiornata.");
    setWarning(res.warning ?? null);
    close();
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Password
      </h2>
      <Card>
        {!open ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-t2">
                La stessa con cui accedi dall&apos;app.
              </p>
              <Button
                onClick={() => {
                  setWarning(null);
                  setOpen(true);
                }}
              >
                Cambia password
              </Button>
            </div>
            {warning ? (
              <p className="rounded-xl border border-border-2 px-3 py-2 text-xs leading-5 text-t2">
                {warning}
              </p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
            <Field label="Password attuale">
              <PasswordInput
                autoComplete="current-password"
                required
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="Nuova password">
              <PasswordInput
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Ripeti la nuova password">
              <PasswordInput
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>

            <PasswordChecklist value={password} />

            <p className="text-xs leading-5 text-t3">
              Gli altri dispositivi dove hai fatto l&apos;accesso verranno
              disconnessi.
            </p>

            {error ? (
              <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" variant="gold" disabled={busy}>
                {busy ? "Salvataggio…" : "Cambia password"}
              </Button>
              <Button type="button" disabled={busy} onClick={close}>
                Annulla
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}

function LegalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="focus-gold flex items-center justify-between px-4 py-3 text-sm text-t1 transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-bg-1"
    >
      {label}
      <span aria-hidden className="text-t4">
        ↗
      </span>
    </a>
  );
}

function NotificationPrefsSection() {
  const { session, profile, refreshProfile } = useAuth();
  const toast = useToast();
  // Stato ottimistico: lo switch deve rispondere subito, il salvataggio segue.
  const [prefs, setPrefs] = useState<NotificationPrefs>(() =>
    prefsFromProfile(profile?.notification_prefs)
  );
  const [saving, setSaving] = useState(false);

  async function toggle(id: NotificationCategory, value: boolean) {
    const next = { ...prefs, [id]: value };
    setPrefs(next);
    setSaving(true);
    try {
      await saveNotificationPrefs(session!.user.id, next);
      await refreshProfile();
    } catch {
      setPrefs(prefs); // rollback
      toast.show("Preferenza non salvata. Riprova.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Notifiche push
      </h2>
      <Card className="p-0">
        {NOTIFICATION_CATEGORIES.map((c, i) => {
          const on = prefs[c.id] ?? true;
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center justify-between gap-4 px-4 py-3.5",
                i > 0 && "border-t border-border"
              )}
            >
              <div>
                <p className="text-sm font-semibold text-t1">{c.label}</p>
                <p className="mt-0.5 text-xs text-t3">{c.description}</p>
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={c.label}
                disabled={saving}
                onClick={() => void toggle(c.id, !on)}
                className={cn(
                  "focus-gold relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
                  on ? "bg-gold" : "bg-bg-3"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-t1 transition-all",
                    on ? "left-[1.375rem]" : "left-0.5"
                  )}
                />
              </button>
            </div>
          );
        })}
      </Card>
      <p className="mt-2 px-1 text-xs leading-5 text-t4">
        Questi interruttori controllano solo gli avvisi push <b>sul telefono</b>:
        la dashboard non ne riceve. Le notifiche restano comunque visibili sia
        qui sia nell&apos;app.
      </p>
    </section>
  );
}

const CONFIRM_WORD = "ELIMINA";

function DeleteAccountSection() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteMyAccount();
      // La sessione è ormai orfana: si esce comunque.
      await signOut();
    } catch (e) {
      toast.show(
        userErrorMessage(e, "Cancellazione non riuscita"),
        "error"
      );
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Zona pericolosa
      </h2>
      <Card className="border-error/30">
        <p className="text-sm font-semibold text-t1">Elimina l&apos;account</p>
        <p className="mt-1 text-xs leading-5 text-t3">
          Foto, recapiti del profilo e file caricati vengono rimossi; il nome
          del profilo diventa «Utente eliminato». Le schede nominative, i
          documenti caricati da altri e lo storico restano alle aziende,
          scollegati dall&apos;account. Al termine non potrai più accedere e
          <b> l&apos;operazione non sarà reversibile.</b>
        </p>

        {!open ? (
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => setOpen(true)}
          >
            Elimina l&apos;account
          </Button>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="text-xs text-t2">
              Scrivi <b className="font-mono text-error">{CONFIRM_WORD}</b> per
              confermare.
            </label>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoFocus
              className="max-w-56"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={word !== CONFIRM_WORD || busy}
                onClick={() => void confirm()}
              >
                {busy ? "Eliminazione…" : "Elimina definitivamente"}
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  setWord("");
                }}
              >
                Annulla
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
