import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/queryKeys";
import { userErrorMessage as errorMessage } from "@/lib/errors";
import { useAdminAccess } from "@/features/admin/hooks";
import { cancelAdminMfaEnrollment, enrollAdminMfa, listAdminMfaFactors, verifyAdminMfa } from "@/features/admin/api";
import { cn } from "@/lib/cn";
import { Button, Field, Input, Placeholder, Select, Spinner } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { SidebarIcon, type SidebarIconName } from "../ui/SidebarIcon";
import { OverviewPage, WorkspacesPage, WorkspacePage, AccountsPage, AccountPage } from "./pages";
export function AdminApp() {
  const { session, signOut } = useAuth();
  const client = useQueryClient();
  const userId = session!.user.id;
  // Ogni JWT richiede una verifica nuova. Dopo la prima riuscita le pagine
  // restano montate, ma inerti e coperte finché il server risponde.
  // Il JWT non entra nella query key né nella cache amministrativa.
  const sessionVersion = useMemo(() => {
    if (!session?.access_token)
      return "signed-out";
    return crypto.randomUUID();
  }, [session?.access_token]);
  const access = useAdminAccess(userId, sessionVersion);
  const [verifiedUser, setVerifiedUser] = useState<string | null>(null);
  const granted = !access.isPending && !access.isError && access.data?.can_access === true;
  const denied = access.isError || (!access.isPending && access.data?.can_access === false);
  // Aggiornamento condizionale prima dei figli: anche un diniego durante una
  // riverifica deve togliere l'albero nello stesso render, senza un frame residuo.
  if (granted && verifiedUser !== userId) setVerifiedUser(userId);
  else if ((denied || (verifiedUser !== null && verifiedUser !== userId)) && verifiedUser !== null) setVerifiedUser(null);
  const keepMounted = granted || (verifiedUser === userId && access.isPending && !denied);
  const rechecking = keepMounted && (access.isPending || access.isFetching);
  useEffect(() => {
    if (denied) {
      void client.cancelQueries({ queryKey: qk.admin.privileged })
        .then(() => client.removeQueries({ queryKey: qk.admin.privileged }));
    }
  }, [denied, client]);
  useEffect(() => () => {
    void client.cancelQueries({ queryKey: qk.admin.all });
    client.removeQueries({ queryKey: qk.admin.all });
  }, [client]);
  const exit = <Button onClick={() => void signOut()}>Esci</Button>;
  if (access.isPending && !keepMounted)
    return <Spinner label="Verifica accesso amministrativo…" />;
  if (access.isError)
    return <AuthShell title="Accesso da verificare" subtitle="Area del fondatore"><AuthPanel><Placeholder title="Accesso da verificare" detail={errorMessage(access.error)} action={<div className="flex gap-2"><Button variant="gold" onClick={() => void access.refetch()}>Riprova</Button>{exit}</div>} /></AuthPanel></AuthShell>;
  if (!keepMounted && !access.data?.eligible)
    return <AuthShell title="Area riservata al fondatore" subtitle="Questo account non dispone dell'accesso amministrativo."><AuthPanel><div className="flex flex-col items-center gap-4 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-bg-2 text-t3"><SidebarIcon name="shield" className="size-6" /></span><div className="flex gap-2"><Link className="focus-gold inline-flex items-center rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink hover:bg-gold-light" to="/">Dashboard cliente</Link>{exit}</div></div></AuthPanel></AuthShell>;
  if (!keepMounted)
    return <MfaForm onVerified={() => void access.refetch()} exit={exit} />;
  const navClass = ({ isActive }: { isActive: boolean }) => cn(
    "focus-gold flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
    isActive ? "bg-gold/12 text-gold" : "text-t2 hover:bg-bg-2 hover:text-t1");
  const footClass = "focus-gold flex min-h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-xs text-t2 transition-colors hover:bg-bg-2 hover:text-t1";
  return <>
    <div className="min-h-dvh bg-bg-0 text-t1 lg:flex" inert={rechecking || undefined} aria-hidden={rechecking || undefined}>
      <aside className="z-20 flex shrink-0 flex-col border-b border-border-2 bg-bg-card lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 pb-4 pt-5 lg:block lg:px-6 lg:pb-5 lg:pt-6">
          <div>
            <div className="mb-4 hidden h-1 w-8 rounded-full bg-gold lg:block" />
            <p className="font-serif text-lg leading-tight">KlokShift · Fondatore</p>
            <p className={cn("mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", access.isFetching ? "bg-bg-3 text-t3" : "bg-success/12 text-success")}>
              <SidebarIcon name="shield" className="size-3.5" />
              {access.isFetching ? 'Verifica accesso in corso…' : <span title="Amministrazione · secondo fattore verificato">Secondo fattore verificato</span>}
            </p>
          </div>
          <div className="flex gap-2 lg:hidden">
            <Button aria-label="Aggiorna" onClick={() => void client.invalidateQueries({ queryKey: qk.admin.all })}><SidebarIcon name="refresh" className="size-4" /></Button>{exit}
          </div>
        </div>
        <nav aria-label="Amministrazione" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:flex-1 lg:space-y-1 lg:pb-6">
          <h2 className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-t3 lg:block">Consultazione</h2>
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/amministrazione'} className={navClass}>
            <SidebarIcon name={item.icon} />{item.label}
          </NavLink>)}
        </nav>
        <div className="hidden shrink-0 border-t border-border-2 p-3 lg:block">
          <button type="button" className={footClass} onClick={() => void client.invalidateQueries({ queryKey: qk.admin.all })}>
            <SidebarIcon name="refresh" />Aggiorna i dati
          </button>
          <Link to="/" className={footClass}><SidebarIcon name="home" />Dashboard cliente</Link>
          <button type="button" className={footClass} onClick={() => void signOut()}><SidebarIcon name="logout" />Esci</button>
        </div>
      </aside>
      <main className="mx-auto min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <Routes>
          <Route path="/amministrazione" element={<OverviewPage userId={userId} />} />
          <Route path="/amministrazione/aziende" element={<WorkspacesPage userId={userId} />} />
          <Route path="/amministrazione/aziende/:id" element={<WorkspacePage userId={userId} />} />
          <Route path="/amministrazione/account" element={<AccountsPage userId={userId} />} />
          <Route path="/amministrazione/account/:id" element={<AccountPage userId={userId} />} />
          <Route path="*" element={<Navigate to="/amministrazione" replace />} />
        </Routes>
      </main>
    </div>
    {rechecking && <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/95" role="status" aria-live="polite">
      <Spinner label="Verifica accesso…" />
    </div>}
  </>;
}
const NAV: { to: string; label: string; icon: SidebarIconName }[] = [
  { to: '/amministrazione', label: 'Panoramica', icon: 'overview' },
  { to: '/amministrazione/aziende', label: 'Aziende', icon: 'building' },
  { to: '/amministrazione/account', label: 'Account', icon: 'user' },
];
function MfaForm({ onVerified, exit }: {
  onVerified: () => void;
  exit: React.ReactNode;
}) {
  const [factors, setFactors] = useState<{
    id: string;
    name: string;
  }[] | null>(null);
  const [pendingFactors, setPendingFactors] = useState<{
    id: string;
    name: string;
  }[]>([]);
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Awaited<ReturnType<typeof enrollAdminMfa>> | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void listAdminMfaFactors().then((next) => {
      if (active) {
        setFactors(next.verified);
        setPendingFactors(next.pending);
        setFactorId(next.verified[0]?.id ?? "");
        setError(null);
      }
    })
      .catch((e: unknown) => {
        if (active)
          setError(errorMessage(e));
      });
    return () => { active = false; };
  }, [attempt]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    }
    catch (e) {
      setError(errorMessage(e));
    }
    finally {
      setBusy(false);
    }
  }
  const configuring = enrollment !== null;
  return <AuthShell title="Verifica del fondatore" subtitle="Usa un’app di autenticazione per completare il secondo fattore. Questa verifica protegge i dati globali.">
    <AuthPanel>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-gold/12 text-gold"><SidebarIcon name="shield" className="size-5" /></span>
        <div><p className="text-sm font-semibold">Secondo fattore</p><p className="text-xs text-t3">Codice a 6 cifre dall’app di autenticazione</p></div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}
      {!enrollment && pendingFactors.length > 0 && <div className="mb-4 space-y-2 rounded-xl bg-bg-1 p-3"><p className="text-sm text-t3">Configurazioni non completate. Puoi rimuoverle e configurare un nuovo fattore.</p>{pendingFactors.map((f) => <div key={f.id} className="flex flex-wrap items-center gap-2"><span className="text-xs text-t3">{f.name}</span><Button disabled={busy} onClick={() => void run(async () => { await cancelAdminMfaEnrollment(f.id); setPendingFactors((current) => current.filter((p) => p.id !== f.id)); })}>Rimuovi configurazione incompleta</Button></div>)}</div>}
      {factors === null ? <><Spinner label="Verifica fattori…" /><Button className="w-full" onClick={() => setAttempt((n) => n + 1)}>Riprova</Button></> :
        factors.length === 0 && !enrollment ? <Button className="w-full" disabled={busy} variant="gold" onClick={() => void run(async () => { const next = await enrollAdminMfa(); setEnrollment(next); setFactorId(next.id); })}>Configura secondo fattore</Button> : <>
          {enrollment && <div className="mb-5"><Step n={1} title="Scansiona il QR nell’app di autenticazione, oppure inserisci la chiave." /><div className="mt-3 flex flex-col items-center gap-3"><img className="h-44 w-44 rounded-xl bg-white p-2" src={enrollment.qr} alt="QR per configurare il secondo fattore" /><code className="block w-full break-all rounded-xl bg-bg-2 p-3 text-center font-mono text-xs text-t2">{enrollment.secret}</code></div></div>}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await verifyAdminMfa(factorId, code); setEnrollment(null); setCode(""); onVerified(); }); }}>
            {configuring && <Step n={2} title="Inserisci il codice che compare nell’app." />}
            {factors.length > 1 && <Field label="App di autenticazione"><Select value={factorId} onChange={(e) => setFactorId(e.target.value)}>{factors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>}
            <Field label="Codice a 6 cifre"><Input className="py-3 text-center font-mono text-2xl tracking-[0.5em]" placeholder="••••••" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
            <Button className="w-full" type="submit" variant="gold" disabled={busy || code.length !== 6}>Verifica e accedi</Button>
          </form>
          {enrollment && <Button className="mt-3 w-full" disabled={busy} onClick={() => void run(async () => { await cancelAdminMfaEnrollment(enrollment.id); setEnrollment(null); setFactorId(""); setCode(""); })}>Annulla configurazione</Button>}
        </>}
      <div className="mt-6 flex justify-center border-t border-border-2 pt-4">{exit}</div>
    </AuthPanel>
  </AuthShell>;
}
function Step({ n, title }: { n: number; title: string }) {
  return <p className="flex items-start gap-3 text-sm text-t2"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold text-xs font-bold text-gold-ink">{n}</span>{title}</p>;
}
