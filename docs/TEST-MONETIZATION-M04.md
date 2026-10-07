# Verifica M04 — esperienza commerciale della beta

Blocco del 6 ottobre 2026. Nessuna nuova migration, modifica ai guard o
integrazione di pagamento. La pagina cliente è `#/piano`; i tab del fondatore
restano verificabili con [TEST-FOUNDER-M06A.md](TEST-FOUNDER-M06A.md), §8.

## Ambiente e avvio

Il frontend da provare **adesso è locale**. Le modifiche non sono pubblicate
da questa sessione. Il backend può essere il progetto attuale
`rmlobxjlqlpixkvrzmfg`, secondo la decisione del fondatore: contiene soltanto
aziende/account propri di test. Il frontend locale collegato a quel progetto
scrive comunque in quel database quando confermi una prova o crei una scheda.
Usare un alias email proprio nuovo per il percorso di registrazione.

Nella root `/Users/alisher/KlokShift`, usare la `.env` già configurata con URL
e chiave pubblica di quel progetto, senza sostituirli con la porta del banco
Postgres Docker. Il banco SQL non offre Auth/REST HTTP. Se la dashboard è già
attiva su 5173, riusarla; altrimenti avviare il primo comando. Il sito usa il
secondo terminale (se già attivo su 5174 con la stessa configurazione, riusarlo):

```sh
yarn web:dev --port 5173 --strictPort
```

```sh
EXPO_PUBLIC_APP_URL=http://localhost:5173 yarn site:dev --port 5174 --strictPort
```

Dashboard: `http://localhost:5173/#/login`. Sito: `http://localhost:5174/`.
La variabile del secondo comando manda le CTA al frontend locale corretto.
Non serve applicare migration per M04. La conferma email Supabase resta attiva;
se il link di conferma riporta al sito pubblico, confermare l’email e poi
accedere manualmente nella dashboard locale.

## 1. Azienda esistente con gratuità

1. Accedere nella dashboard locale con il titolare di **Da Buffa** e aprire
   **Piano e accesso** nel menu Gestione. Verificare il nome dell’azienda in cima.
2. Atteso: azienda Operativa, piano Team, origine Gratuito a vita, persone senza
   limite, una sede consentita, nessuna scadenza commerciale e nessun pulsante
   per avviare una prova. L’assegnazione già confermata dal fondatore resta tale.
3. Aprire **Listino previsto al lancio**. Atteso: prezzi separati dalla
   situazione attuale; spiegazione che i pagamenti non sono disponibili.
   Cambiare sedi e periodo non cambia la concessione o il piano aziendale.
4. Selezionare Mensile e 2 sedi: Base **44 €**, Team **64 €**. Selezionare
   Annuale e 3 sedi: Base **590 €**, Team **790 €**, pagamento per 12 mesi
   consecutivi. Gli equivalenti mensili sono circa 49,17 € e 65,83 €;
   gli importi principali restano quelli annuali, IVA esclusa.
5. Inserire 0, un numero frazionario o cancellare il numero sedi: atteso errore
   di input e nessun totale. Rimettere 1 ripristina il listino.
6. Aprire **Storico turni** e **Ore ed export**; scegliere un mese con dati ed
   esportare CSV/PDF. Atteso: dati e intestazione dell’azienda corretti. Nessun
   lucchetto Pro o richiesta di pagamento per consultare/esportare.

## 2. Azienda vecchia ancora da configurare

1. Accedere come titolare di **Bar Teatro**, se non è stata nel frattempo
   attivata esplicitamente. Usare l’account che ne è titolare: la dashboard
   usa l’azienda gestita dal contesto, non l’azienda scelta nell’area fondatore.
2. Aprire **Piano e accesso**. Atteso: Configurazione in verifica, piano e limiti
   Non assegnato; conteggi effettivi distinti dai limiti. Nessun “senza limite”
   dedotto dal vecchio Pro e nessun avvio prova.
3. Aprire il planning e compiere una normale operazione già disponibile,
   quindi consultare lo storico/export. Atteso: l’eccezione di migrazione
   mantiene il funzionamento precedente. Aprire la pagina o il listino non
   assegna una prova, una gratuità o capacità.

## 3. Nuova azienda: percorso reale dal sito

1. Dal sito locale, cliccare **Prova la beta** in apertura o nel listino.
   Atteso: registrazione su `localhost:5173/#/registrati`, senza checkout.
2. Registrare un nuovo alias email proprio, confermare l’email e accedere.
3. Aprire l’azienda dal modulo iniziale con nome **TEST M04 — prova**.
   Atteso: dopo la creazione della prima sede si apre Piano e accesso;
   stato Da configurare, nessun piano attivo, nessuna scadenza di prova.
4. Cliccare **Avvia la prova di 30 giorni**, poi **Annulla**. Atteso: nessuna
   attivazione. Ricaricare conferma ancora Da configurare.
5. Ripetere e scegliere **Conferma e avvia la prova**. Atteso: Operativa,
   origine Prova gratuita, piano Team, una sede consentita; inizio e fine
   determinati dal server, fine prova a 30 giorni. Sono visibili anche il
   termine rettifiche (+7 giorni) e il termine archivio (+12 mesi).
6. Ricaricare e usare Aggiorna stato più volte: atteso stesse date, nessuna
   nuova prova. La prova non è rinnovabile tramite un pulsante di riavvio.
7. Aggiungere una scheda all’organico e creare un turno. Atteso: operazioni
   consentite. Tentare una seconda sede: atteso limite di una sede; nessuna
   promessa di sblocco o acquisto disponibile durante questa beta.

## 4. Permessi, errore di rete e app

1. Come collaboratore di test, verificare che Piano e accesso non sia nel
   menu; digitare `#/piano`. Atteso: sezione riservata al titolare e nessun
   modulo di attivazione/listino. Il banner resta neutro e i permessi delle
   altre pagine rimangono quelli del membro.
2. Come titolare, dopo un caricamento valido bloccare nelle DevTools soltanto
   le richieste a `*/rest/v1/rpc/get_workspace_access` e premere Aggiorna stato.
   Attendere l’esaurimento dei retry della query. Atteso: stato non disponibile,
   nessun vecchio diritto in cache mostrato come attuale, nessun avvio prova;
   i link allo storico non spariscono. Sbloccare e aggiornare ripristina lo stato.
3. Aprire l’app nativa con lo stesso account, profilo del gestore → stato azienda.
   Atteso: stato/date/capacità coerenti col server, nessun prezzo, checkout o
   invito ad acquistare. Questa parte nativa preesiste e non è stata modificata.
4. Tastiera: raggiungere i link e il listino con Tab, aprire con Invio e usare
   il selettore mensile/annuale. Provare anche una finestra più stretta.
   Atteso: etichette leggibili e nessuna sovrapposizione nei nuovi pannelli.

## 5. Archivio e fine rettifiche

Le prove server su scadenza, storico di sedi chiuse e dati precedenti all’ultimo
anno restano nella suite M03b; i nuovi test client verificano anche che nella
pagina commerciale l’archivio conservi i percorsi allo storico e separi le date.
Non cambiare le date di Da Buffa o di Bar Teatro per simulare la scadenza.

La prova visuale usa una fixture dedicata **TEST M04 — prova** del §3, oppure un
dev isolato quando disponibile. Nel SQL editor del progetto di test selezionare
il suo UUID preciso e il periodo di prova; salvare l’output originale prima
di procedere:

```sql
select w.id as workspace_id, w.name, p.id as period_id, p.kind,
       p.starts_at, p.ends_at, p.revoked_at
from public.workspaces w
join public.workspace_access_periods p on p.workspace_id = w.id
where w.name = 'TEST M04 — prova';
```

Usare **solo gli UUID della fixture appena creata**. Per simulare fine prova
con rettifiche ancora aperte, sostituire i due UUID nel blocco:

```sql
begin;
do $$
declare
  fixture uuid := 'UUID_AZIENDA_TEST_M04';
  period uuid := 'UUID_PERIODO_TRIAL_TEST_M04';
  cutoff timestamptz := now() - interval '1 minute';
begin
  perform 1 from public.workspaces
   where id = fixture and name = 'TEST M04 — prova' and deleted_at is null
   for update;
  if not found or (select count(*) from public.workspace_access_periods
                   where workspace_id = fixture) <> 1 then
    raise exception 'Usare solo la nuova fixture TEST M04 con un unico periodo';
  end if;
  update public.workspace_access_periods
     set starts_at = cutoff - interval '720 hours', ends_at = cutoff
   where id = period and workspace_id = fixture and kind = 'trial'
     and revoked_at is null;
  if not found then raise exception 'Periodo di prova fixture non trovato'; end if;
end $$;
commit;
```

Aggiornare la pagina: atteso In archivio, niente nuovi turni o nuova prova,
storico/export disponibili, finestra rettifiche ancora aperta. Per una rettifica
visuale preparare prima un turno di ieri con assegnazione e attendere almeno
un minuto prima dello script: il record e il turno devono precedere il cutoff.
La rettifica valida non cambia il termine archivio.

Ripetere il blocco cambiando soltanto `cutoff` in
`now() - interval '8 days'`. Atteso: archivio ancora consultabile, rettifiche
non più consentite. Per ripristinare la prova della sola fixture, usare gli
**istanti originali salvati**, sostituendo tutti i placeholder:

```sql
update public.workspace_access_periods p
   set starts_at = 'INIZIO_ORIGINALE_CON_OFFSET'::timestamptz,
       ends_at = 'FINE_ORIGINALE_CON_OFFSET'::timestamptz
 where p.id = 'UUID_PERIODO_TRIAL_TEST_M04'::uuid
   and p.workspace_id = 'UUID_AZIENDA_TEST_M04'::uuid
   and p.kind = 'trial' and p.revoked_at is null
   and exists (select 1 from public.workspaces w
               where w.id = p.workspace_id and w.name = 'TEST M04 — prova')
returning p.id, p.starts_at, p.ends_at;
```

Atteso: una sola riga ripristinata e, dopo refresh, prova operativa con le
date originali. Non modificare `trial_started_at`: resta la prova già usata.
Questa simulazione è esclusivamente una fixture, non gestione commerciale reale.

## Esito della sessione locale

- 43 file / **311 test client** passati: include listino, controlli UI sul
  titolare, legacy senza piano, concessione, setup, archivio ed errore con cache.
- Typecheck app, dashboard e sito; lint senza errori, un warning preesistente
  React Hook Form; build dashboard/sito ed export iOS passati. Il bundle dashboard mantiene
  il warning dimensione già presente.
- Smoke HTTP locale: moduli pagina/listino e configurazione CTA serviti con
  HTTP 200 da Vite; nessuna richiesta al backend da questo smoke.
- Nessuna migration/SQL remota, commit/push o pubblicazione eseguita qui.
- Le prove visuali/interactive sopra e la simulazione SQL sono **da eseguire**;
  i test React della sessione sono rendering server, non un browser reale.
- La suite SQL/RLS e concorrenza non è stata ripetuta per questa modifica UI:
  nessun guard, schema o RPC è cambiato; ultimo gate M06a: 15 file SQL/RLS e
  6 concorrenti passati.
- M04 è pronto per la beta sul frontend locale. Acquisto/gestione contratto
  richiedono M09/Paddle e M11; non sono simulati da questa pagina.
