import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { userErrorMessage } from "@/lib/errors";
import { changePasswordSchema } from "@/features/auth/schema";
import { hasVerifiedTotp } from "@/features/auth/changePassword";
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
  Field,
  Input,
  PageHeader,
  PasswordInput,
} from "../ui/primitives";
import { Avatar } from "../ui/Avatar";
import { SidebarIcon, type SidebarIconName } from "../ui/SidebarIcon";
import { PasswordChecklist } from "../ui/PasswordChecklist";
import { useToast } from "../ui/Toast";
import { AVATAR_ACCEPT, prepareAvatar } from "../lib/avatarFile";

type SectionId = "profilo" | "sicurezza" | "notifiche" | "azienda" | "documenti" | "elimina";

/**
 * Impostazioni come quelle di Mac o GitHub: a sinistra l'elenco delle sezioni,
 * a destra una sezione alla volta. La sezione aperta sta nell'indirizzo
 * (`?sezione=`), così un link porta dritto lì e «indietro» torna alla
 * precedente. L'eliminazione dell'account è in fondo, separata e in rosso.
 */
export function ImpostazioniPage() {
  const { isOwner, workspaceId } = useOwnerVenues();
  const [params, setParams] = useSearchParams();

  const sections: { id: SectionId; label: string; icon: SidebarIconName; danger?: boolean }[] = [
    { id: "profilo", label: "Profilo", icon: "user" },
    { id: "sicurezza", label: "Sicurezza", icon: "shield" },
    { id: "notifiche", label: "Notifiche", icon: "notifications" },
    ...(isOwner && workspaceId ? [{ id: "azienda" as const, label: "Azienda", icon: "venue" as const }] : []),
    { id: "documenti", label: "Documenti", icon: "file" },
    { id: "elimina", label: "Elimina account", icon: "trash", danger: true },
  ];
  const current = sections.find((x) => x.id === params.get("sezione"))?.id ?? "profilo";

  return (
    <>
      <PageHeader title="Impostazioni" subtitle="Il tuo profilo, l'accesso e le preferenze" />

      <div className="max-w-5xl">
        {/* Schede in alto, come la scheda azienda dell'area fondatore: una
            sezione alla volta senza una seconda colonna di menu accanto alla
            sidebar. «Elimina account» sta in fondo a destra, staccato. */}
        <nav
          aria-label="Sezioni delle impostazioni"
          className="mb-6 flex gap-1 overflow-x-auto border-b border-border-2"
        >
          {sections.map((x) => {
            const active = x.id === current;
            return (
              <button
                key={x.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("sezione", x.id);
                  return next;
                })}
                className={cn(
                  "focus-gold -mb-px flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                  x.danger && "ml-auto",
                  active
                    ? x.danger ? "border-error text-error" : "border-gold text-gold"
                    : x.danger
                      ? "border-transparent text-t3 hover:text-error"
                      : "border-transparent text-t3 hover:text-t1"
                )}
              >
                <SidebarIcon name={x.icon} className="size-4" />
                {x.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {current === "profilo" ? <AccountSection /> : null}
          {current === "sicurezza" ? <PasswordSection /> : null}
          {current === "notifiche" ? <NotificationPrefsSection /> : null}
          {current === "azienda" && workspaceId ? <CompanySection workspaceId={workspaceId} /> : null}
          {current === "documenti" ? (
            <SettingsCard icon="file" title="Documenti" description="Le pagine legali sul sito di KlokShift.">
              <LegalLink href={LEGAL_URLS.privacy} label="Informativa privacy" />
              <LegalLink
                href={LEGAL_URLS.accountDeletion}
                label="Come cancellare l'account"
              />
            </SettingsCard>
          ) : null}
          {current === "elimina" ? <DeleteAccountSection /> : null}
        </div>
      </div>
    </>
  );
}

/**
 * Una sezione delle impostazioni: icona, titolo e spiegazione stanno dentro la
 * card, le righe sotto, separate da un filo. Prima titoletti e note erano
 * fuori, e ogni sezione aveva una forma diversa.
 */
function SettingsCard({
  icon,
  title,
  description,
  action,
  danger = false,
  children,
}: {
  icon: SidebarIconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border bg-bg-card", danger ? "border-error/30" : "border-border-2")}>
      <header className="flex flex-wrap items-start gap-4 p-5">
        <span
          aria-hidden
          className={cn("grid size-10 shrink-0 place-items-center rounded-xl", danger ? "bg-error/10 text-error" : "bg-gold/10 text-gold")}
        >
          <SidebarIcon name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-t1">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-5 text-t3">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children ? <div className="divide-y divide-border border-t border-border">{children}</div> : null}
    </section>
  );
}

const ACCESS_SOURCE: Record<string, string> = {
  trial: "Prova gratuita", complimentary_lifetime: "Gratuito a vita", complimentary_temporary: "Concessione a tempo",
  transition: "Accesso transitorio", subscription: "Abbonamento", payment_grace: "Rinnovo in sospeso",
};

/** Azienda: il piano in una riga e l'interruttore della chat. Solo il titolare. */
function CompanySection({ workspaceId }: { workspaceId: string }) {
  const { workspaceName, access } = useOwnerVenues();
  const summary = access?.plan
    ? [access.plan === "team" ? "Team" : "Base", access.source ? ACCESS_SOURCE[access.source] : null].filter(Boolean).join(" · ")
    : "Stato, capacità e abbonamento";
  return (
    <SettingsCard icon="venue" title="Azienda" description={workspaceName ?? undefined}>
      <Link
        to="/piano"
        className="focus-gold group flex items-center gap-4 px-5 py-4 transition hover:bg-bg-1"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-t1">Piano e accesso</span>
          <span className="mt-0.5 block text-xs text-t3">{summary}</span>
        </span>
        <span aria-hidden className="text-t4 transition group-hover:translate-x-0.5 group-hover:text-gold">›</span>
      </Link>
      <StaffChatRow workspaceId={workspaceId} />
    </SettingsCard>
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
function StaffChatRow({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  // Lo stato vero o niente: un interruttore «acceso» per difetto, con la
  // lettura fallita, direbbe una cosa non verificata e al primo clic la
  // scriverebbe al contrario.
  const { data: enabled, isError } = useStaffCanChat(workspaceId);
  const save = useSetStaffCanChat();

  return (
        <label className="flex cursor-pointer items-center gap-4 px-5 py-4 has-disabled:cursor-not-allowed">
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
            className="relative h-6 w-11 shrink-0 rounded-full bg-bg-3 transition peer-checked:bg-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg-card peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-t1 after:transition-all peer-checked:after:translate-x-5"
          />
        </label>
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
  const { session, profile, refreshProfile } = useAuth();
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
    <section className="overflow-hidden rounded-2xl border border-border-2 bg-linear-to-br from-bg-card to-bg-1">
      <div className="flex flex-wrap items-center gap-5 p-6">
        <Avatar
          url={profile?.avatar_url}
          name={profile?.full_name ?? session?.user.email ?? "?"}
          size={76}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-t3">Profilo</p>
          {editing ? null : (
            <p className="max-w-full truncate font-serif text-2xl leading-tight text-t1">
              {profile?.full_name || "Nome non indicato"}
            </p>
          )}
          <p className="max-w-full truncate text-sm text-t3">{session?.user.email}</p>
          {editing ? (
            <div className="mt-2 flex flex-wrap gap-2">
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
        {!editing ? (
          <Button
            className="shrink-0"
            onClick={() => {
              setName(profile?.full_name ?? "");
              setEditing(true);
            }}
          >
            Modifica
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border px-6 py-5">
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
        </div>
      ) : null}

      <p className="flex items-start gap-2 border-t border-border bg-bg-0/30 px-6 py-3 text-xs leading-5 text-t3">
        <SidebarIcon name="help" className="mt-0.5 size-3.5 text-t4" />
        <span>
          È lo stesso profilo dell&apos;app: nome e foto si vedono in chat e sui
          turni. La sede — nome, indirizzo, logo — si modifica dalla scheda
          Sede.
        </span>
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
 * Con il secondo fattore (D5) chiede anche il codice TOTP: la verifica della
 * password attuale apre una sessione `aal1`, e il cambio passa solo col codice.
 *
 * Se la password cambia ma gli altri dispositivi non si disconnettono,
 * `warning` resta scritto nella sezione (non come errore) finché non si riapre
 * il modulo: un toast sparirebbe da solo.
 */
function PasswordSection() {
  const { changePassword, session } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  // Il campo del codice si vede subito per chi ha il secondo fattore; se la
  // sessione non lo sa ancora, compare quando il cambio lo chiede.
  const [codeAsked, setCodeAsked] = useState(false);
  const needsCode = codeAsked || hasVerifiedTotp(session?.user);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setCode("");
    setCodeAsked(false);
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
    const res = await changePassword(current, password, needsCode ? code : undefined);
    setBusy(false);
    if (res.error) {
      if (res.codeRequired) setCodeAsked(true);
      setError(res.error);
      return;
    }
    toast.show("Password aggiornata.");
    setWarning(res.warning ?? null);
    close();
  }

  return (
    <SettingsCard
      icon="shield"
      title="Password"
      description="La stessa con cui accedi dall'app."
      action={
        open ? undefined : (
          <Button
            onClick={() => {
              setWarning(null);
              setOpen(true);
            }}
          >
            Cambia password
          </Button>
        )
      }
    >
      {warning && !open ? (
        <p className="px-5 py-4 text-xs leading-5 text-t2">{warning}</p>
      ) : null}
      {open ? (
        <div className="px-5 py-5">
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

            {needsCode ? (
              <Field label="Codice dell'app di autenticazione">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            ) : null}

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
        </div>
      ) : null}
    </SettingsCard>
  );
}

function LegalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="focus-gold group flex items-center justify-between px-5 py-3.5 text-sm text-t1 transition hover:bg-bg-1"
    >
      {label}
      <span aria-hidden className="text-t4 transition group-hover:text-gold">
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
    <SettingsCard
      icon="notifications"
      title="Notifiche push"
      description={
        <>
          Valgono solo per gli avvisi <b className="text-t2">sul telefono</b>: la dashboard non ne
          riceve. Le notifiche restano comunque visibili sia qui sia nell&apos;app.
        </>
      }
    >
      {NOTIFICATION_CATEGORIES.map((c) => {
        const on = prefs[c.id] ?? true;
        return (
          <div
            key={c.id}
            className="flex items-center justify-between gap-4 px-5 py-4"
          >
            <div>
              <p className="text-sm font-medium text-t1">{c.label}</p>
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
    </SettingsCard>
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
    <SettingsCard
      danger
      icon="trash"
      title="Elimina l'account"
      description={
        <>
          Foto e recapiti del profilo vengono rimossi; il nome del profilo
          diventa «Utente eliminato». Le schede nominative, i loro documenti
          e lo storico restano alle aziende,
          scollegati dall&apos;account. Al termine non potrai più accedere e
          <b className="text-t2"> l&apos;operazione non sarà reversibile.</b>
        </>
      }
    >
      <div className="px-5 py-4">
        {!open ? (
          <Button variant="danger" onClick={() => setOpen(true)}>
            Elimina l&apos;account
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
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
      </div>
    </SettingsCard>
  );
}
