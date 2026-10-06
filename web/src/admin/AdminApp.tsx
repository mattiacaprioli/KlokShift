import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/queryKeys";
import { userErrorMessage as errorMessage } from "@/lib/errors";
import { useAdminAccess } from "@/features/admin/hooks";
import { cancelAdminMfaEnrollment, enrollAdminMfa, listAdminMfaFactors, verifyAdminMfa } from "@/features/admin/api";
import { Button, Card, Field, Input, Placeholder, Select, Spinner } from "../ui/primitives";
import { OverviewPage, WorkspacesPage, WorkspacePage, AccountsPage, AccountPage } from "./pages";
export function AdminApp() {
  const { session, signOut } = useAuth();
  const client = useQueryClient();
  const userId = session!.user.id;
  // Il cambio JWT produce una verifica nuova prima di mostrare dati. Il JWT
  // non entra nella query key né nella cache amministrativa.
  const sessionVersion = useMemo(() => {
    if (!session?.access_token)
      return "signed-out";
    return crypto.randomUUID();
  }, [session?.access_token]);
  const access = useAdminAccess(userId, sessionVersion);
  useEffect(() => {
    if (access.isError || !access.data?.can_access) {
      void client.cancelQueries({ queryKey: qk.admin.privileged });
      client.removeQueries({ queryKey: qk.admin.privileged });
    }
  }, [access.isError, access.data?.can_access, client]);
  useEffect(() => () => {
    void client.cancelQueries({ queryKey: qk.admin.all });
    client.removeQueries({ queryKey: qk.admin.all });
  }, [client]);
  const exit = <Button onClick={() => void signOut()}>Esci</Button>;
  if (access.isPending)
    return <Spinner label="Verifica accesso amministrativo…" />;
  if (access.isError)
    return <div className="mx-auto max-w-xl p-8"><Placeholder title="Accesso da verificare" detail={errorMessage(access.error)} action={<div className="flex gap-2"><Button onClick={() => void access.refetch()}>Riprova</Button>{exit}</div>} /></div>;
  if (!access.data.eligible)
    return <div className="mx-auto max-w-xl p-8"><Placeholder title="Area riservata al fondatore" detail="Questo account non dispone dell'accesso amministrativo." action={<div className="flex gap-2"><Link className="text-gold" to="/">Dashboard cliente</Link>{exit}</div>} /></div>;
  if (!access.data.can_access)
    return <MfaForm onVerified={() => void access.refetch()} exit={exit} />;
  return <div className="min-h-screen bg-bg-0 text-t1">
    <header className="border-b border-border-2 p-5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <div><p className="font-serif text-xl">KlokShift · Fondatore</p><p className="text-xs text-t3">{access.isFetching ? 'Verifica accesso in corso…' : 'Amministrazione · secondo fattore verificato'}</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-sm text-t3">Dashboard cliente</Link>
          <Button onClick={() => void client.invalidateQueries({ queryKey: qk.admin.all })}>Aggiorna</Button>{exit}
        </div>
      </div>
      <nav aria-label="Amministrazione" className="mx-auto mt-5 flex max-w-7xl gap-6 text-sm">
        {[['/amministrazione', 'Panoramica'], ['/amministrazione/aziende', 'Aziende'], ['/amministrazione/account', 'Account']].map(([to, label]) => <NavLink key={to} to={to} end={to === '/amministrazione'} className={({ isActive }) => isActive ? 'font-semibold text-gold' : 'text-t3'}>{label}</NavLink>)}
      </nav>
    </header>
    <main className="mx-auto max-w-7xl p-6">
      <Routes>
        <Route path="/amministrazione" element={<OverviewPage userId={userId} />} />
        <Route path="/amministrazione/aziende" element={<WorkspacesPage userId={userId} />} />
        <Route path="/amministrazione/aziende/:id" element={<WorkspacePage userId={userId} />} />
        <Route path="/amministrazione/account" element={<AccountsPage userId={userId} />} />
        <Route path="/amministrazione/account/:id" element={<AccountPage userId={userId} />} />
        <Route path="*" element={<Navigate to="/amministrazione" replace />} />
      </Routes>
    </main>
  </div>;
}
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
  return <main className="mx-auto max-w-lg p-6 py-12"><Card>
    <h1 className="font-serif text-2xl">Verifica del fondatore</h1>
    <p className="my-4 text-sm text-t3">Usa un’app di autenticazione per completare il secondo fattore. Questa verifica protegge i dati globali.</p>
    {error && <p role="alert" className="mb-4 text-sm text-error">{error}</p>}
    {!enrollment && pendingFactors.length > 0 && <div className="mb-4 space-y-2"><p className="text-sm text-t3">Configurazioni non completate. Puoi rimuoverle e configurare un nuovo fattore.</p>{pendingFactors.map((f) => <div key={f.id} className="flex flex-wrap items-center gap-2"><span className="text-xs text-t3">{f.name}</span><Button disabled={busy} onClick={() => void run(async () => { await cancelAdminMfaEnrollment(f.id); setPendingFactors((current) => current.filter((p) => p.id !== f.id)); })}>Rimuovi configurazione incompleta</Button></div>)}</div>}
    {factors === null ? <><Spinner label="Verifica fattori…" /><Button onClick={() => setAttempt((n) => n + 1)}>Riprova</Button></> :
      factors.length === 0 && !enrollment ? <Button disabled={busy} variant="gold" onClick={() => void run(async () => { const next = await enrollAdminMfa(); setEnrollment(next); setFactorId(next.id); })}>Configura secondo fattore</Button> : <>
        {enrollment && <div className="my-4 space-y-3"><p className="text-sm">Scansiona il QR nell’app di autenticazione, oppure inserisci la chiave.</p><img className="h-48 w-48 rounded bg-white" src={enrollment.qr} alt="QR per configurare il secondo fattore" /><code className="block break-all rounded bg-bg-2 p-3 text-sm">{enrollment.secret}</code></div>}
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await verifyAdminMfa(factorId, code); setEnrollment(null); setCode(""); onVerified(); }); }}>
          {factors.length > 1 && <Field label="App di autenticazione"><Select value={factorId} onChange={(e) => setFactorId(e.target.value)}>{factors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>}
          <Field label="Codice a 6 cifre"><Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button type="submit" variant="gold" disabled={busy || code.length !== 6}>Verifica e accedi</Button>
        </form>
        {enrollment && <Button className="mt-3" disabled={busy} onClick={() => void run(async () => { await cancelAdminMfaEnrollment(enrollment.id); setEnrollment(null); setFactorId(""); setCode(""); })}>Annulla configurazione</Button>}
      </>}
    <div className="mt-6">{exit}</div>
  </Card></main>;
}
